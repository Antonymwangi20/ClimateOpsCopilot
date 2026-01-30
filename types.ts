
export enum AgentStatus {
  IDLE = 'IDLE',
  OBSERVING = 'OBSERVING',
  ORIENTING = 'ORIENTING',
  DECIDING = 'DECIDING',
  ACTING = 'ACTING',
  RECHECKING = 'RECHECKING'
}

export interface ClimatePlan {
  id: string;
  timestamp: string;
  location: string;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  summary: string;
  reasoningTrace: string;
  overallConfidence: number; // 0-100 percentage
  weather: {
    temperature: number;
    rainfall: string;
    windSpeed: string;
    windDirection: string;
  };
  nextSteps: string[]; // Risk and confidence-aware next steps
  checklists: {
    title: string;
    items: { task: string; priority: 'LOW' | 'MEDIUM' | 'HIGH'; completed: boolean }[];
  }[];
  confidenceMetrics: {
    satellite: number;
    weather: number;
    documents: number;
  };
  floodPolygons: [number, number][][]; // Array of coordinate arrays
  groundingUrls?: { title: string; uri: string }[];
  rawAIResponse?: {
    text?: string;
    candidates?: any;
  };
}
