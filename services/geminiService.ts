
import { GoogleGenAI, Type } from "@google/genai";
import { AgentStatus, ClimatePlan } from "../types";
import { WeatherData } from "./weatherService";

// Utility for retrying a promise-returning function with exponential backoff.

async function withRetry<T>(
  fn: () => Promise<T>,
  retries = 3,
  delay = 2000,
  factor = 2
): Promise<T> {
  try {
    return await fn();
  } catch (error: any) {
    const isQuotaError = error?.message?.includes('429') || error?.status === 'RESOURCE_EXHAUSTED' || error?.message?.includes('quota');
    
    if (retries <= 0) throw error;
    
    // If it's a quota error, we wait significantly longer
    const waitTime = isQuotaError ? Math.max(delay, 15000) : delay;
    
    console.warn(`API call failed (${error?.status || 'Error'}). Retrying in ${waitTime}ms...`, error);
    await new Promise((resolve) => setTimeout(resolve, waitTime));
    return withRetry(fn, retries - 1, waitTime * factor, factor);
  }
}

export const generateAgenticPlan = async (
  location: string,
  weatherData: WeatherData,
  imageInput?: string, // base64
  docInput?: string,
  onStatusChange?: (status: AgentStatus) => void
): Promise<ClimatePlan> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY! });

  if (onStatusChange) onStatusChange(AgentStatus.OBSERVING);
  
  if (onStatusChange) onStatusChange(AgentStatus.ORIENTING);

  // Updated MISSION and REQUIRED ACTIONS to use provided weather data
  const systemInstruction = `
    MISSION: Generate a real-time climate operations plan for ${location}.
    
    CURRENT WEATHER CONDITIONS (from OpenWeather):
    - Temperature: ${weatherData.temperature}°C
    - Wind Speed: ${weatherData.windSpeed}
    - Wind Direction: ${weatherData.windDirection}
    - Rainfall: ${weatherData.rainfall}
    - Conditions: ${weatherData.description}
    
    REQUIRED ACTIONS:
    1. ANALYZE: Review the provided satellite/context data for local environmental threats using the weather conditions above.
    2. DECIDE: Set riskLevel and generate a tactical OODA checklist based on current weather patterns.
    3. PROVIDE: Provide 3-5 estimated coordinates ([lat, lng]) for potential flood risk areas based on topography and current weather.
    
    CONSTRAINTS: 
    - Use the weather data provided above (do NOT make additional API calls).
    - Return ONLY valid JSON matching the provided schema.
  `;

  let response;
  try {
    // Structure contents with a parts array and move mission details to systemInstruction.
    response = await withRetry(() => ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: {
        parts: [
          { text: `Initiate operational climate loop for: ${location}` },
          ...(imageInput ? [{ inlineData: { mimeType: 'image/jpeg', data: imageInput } }] : [])
        ]
      },
      config: {
        systemInstruction: systemInstruction,
        thinkingConfig: { thinkingBudget: 1024 },
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            riskLevel: { 
              type: Type.STRING,
              description: "The calculated risk level: LOW, MEDIUM, HIGH, or CRITICAL."
            },
            summary: { type: Type.STRING },
            reasoningTrace: { type: Type.STRING },
            overallConfidence: { type: Type.NUMBER },
            weather: {
              type: Type.OBJECT,
              properties: {
                temperature: { type: Type.NUMBER },
                rainfall: { type: Type.STRING },
                windSpeed: { type: Type.STRING },
                windDirection: { type: Type.STRING }
              }
            },
            floodPolygons: {
              type: Type.ARRAY,
              items: {
                type: Type.ARRAY,
                items: {
                  type: Type.ARRAY,
                  items: { type: Type.NUMBER }
                }
              },
              description: "Array of polygons, each an array of [lat, lng] pairs."
            },
            confidenceMetrics: {
              type: Type.OBJECT,
              properties: {
                satellite: { type: Type.NUMBER },
                weather: { type: Type.NUMBER },
                documents: { type: Type.NUMBER }
              }
            },
            checklists: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  title: { type: Type.STRING },
                  items: {
                    type: Type.ARRAY,
                    items: {
                      type: Type.OBJECT,
                      properties: {
                        task: { type: Type.STRING },
                        priority: { type: Type.STRING },
                        completed: { type: Type.BOOLEAN }
                      }
                    }
                  }
                }
              }
            }
          },
          required: ["riskLevel", "summary", "reasoningTrace", "checklists", "confidenceMetrics", "overallConfidence", "weather", "floodPolygons"]
        }
      }
    }));
  } catch (error: any) {
    if (error?.message?.includes('Requested entity was not found')) {
      throw new Error("API_KEY_RESET_REQUIRED");
    }
    throw error;
  }

  if (onStatusChange) onStatusChange(AgentStatus.DECIDING);

  let planData: any = {};
  try {
    // Access response text property directly as it is not a method.
    const text = response.text || '{}';
    planData = JSON.parse(text);
  } catch (e) {
    console.error("Failed to parse AI JSON response:", response.text);
    throw new Error("Invalid operational data format received.");
  }
  
  // Extract grounding information for required attribution.
  const groundingChunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
  const groundingUrls = groundingChunks
    .filter((chunk: any) => chunk.web)
    .map((chunk: any) => ({
      title: chunk.web.title,
      uri: chunk.web.uri
    }));

  if (onStatusChange) onStatusChange(AgentStatus.ACTING);
  await new Promise(r => setTimeout(r, 100));

  return {
    id: Math.random().toString(36).substr(2, 9),
    timestamp: new Date().toISOString(),
    location,
    riskLevel: planData.riskLevel || 'LOW',
    summary: planData.summary || 'No summary generated.',
    reasoningTrace: planData.reasoningTrace || 'No trace available.',
    overallConfidence: planData.overallConfidence || 0,
    weather: planData.weather || { temperature: 0, rainfall: 'N/A', windSpeed: 'N/A', windDirection: 'N/A' },
    confidenceMetrics: planData.confidenceMetrics || { satellite: 0, weather: 0, documents: 0 },
    checklists: planData.checklists || [],
    floodPolygons: planData.floodPolygons || [],
    nextSteps: planData.nextSteps || [],
    groundingUrls
  };
};
