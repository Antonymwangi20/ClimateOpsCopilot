import { useState, useEffect } from 'react';
import { AgentStatus, ClimatePlan } from '../types';
import { fetchWeatherData } from '../services/weatherService';

// API base URL: use env var for production, fallback to localhost:4000 for local dev
const API_BASE = import.meta.env.VITE_WORKER_API || 'http://localhost:4000';

export const useClimateOps = () => {
  const [activePlan, setActivePlan] = useState<ClimatePlan | null>(null);
  const [agentStatus, setAgentStatus] = useState<AgentStatus>(AgentStatus.IDLE);
  const [loading, setLoading] = useState(false);
  const [location, setLocation] = useState('Miami, FL');
  const [selectedImage, setSelectedImage] = useState<File | null>(null);
  const [isCrisisEnabled, setIsCrisisEnabled] = useState(false);
  const [mapCenter, setMapCenter] = useState<[number, number]>([25.7617, -80.1918]);

  // Clear active plan (and polygons) when user changes location
  useEffect(() => {
    if (activePlan && location !== activePlan.location) {
      setActivePlan(null);
      setAgentStatus(AgentStatus.IDLE);
    }
  }, [location, activePlan]);

  // When the `location` text changes, attempt a lightweight geocode (Nominatim)
  // and pan the map to the first result. Debounced to avoid spamming the API.
  useEffect(() => {
    if (!location || location.trim().length === 0) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const q = encodeURIComponent(location.trim());
        const url = `https://nominatim.openstreetmap.org/search?q=${q}&format=json&limit=1`;
        const resp = await fetch(url, { headers: { 'User-Agent': 'climate-ops/0.1 (mailto:devnull@example.com)' } });
        if (!resp.ok) return;
        const data = await resp.json();
        if (cancelled) return;
        if (Array.isArray(data) && data.length > 0) {
          const item = data[0];
          const lat = parseFloat(item.lat);
          const lon = parseFloat(item.lon);
          if (!Number.isNaN(lat) && !Number.isNaN(lon)) setMapCenter([lat, lon]);
        }
      } catch (e) {
        // ignore geocoding errors
        console.warn('Geocode failed', e);
      }
    }, 700);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [location]);


  const startAnalysis = async () => {
    setLoading(true);
    setAgentStatus(AgentStatus.OBSERVING);
    
    // Fix: Destructure once at the top of the function scope
    const [lat, lon] = mapCenter;
    
    try {
      // compute bbox around current map center (~15km buffer)
      const delta = 0.15;
      const bbox = [lon - delta, lat - delta, lon + delta, lat + delta];
      
      const today = new Date();
      const recentDate = new Date(today);
      recentDate.setDate(recentDate.getDate() - 3);
      const date = recentDate.toISOString().slice(0, 10);

      // 1) ingest
      let ingestResp: Response;
      if (selectedImage) {
        const formData = new FormData();
        formData.append('image', selectedImage);
        formData.append('bbox', JSON.stringify(bbox));
        formData.append('date', date);
        ingestResp = await fetch(`${API_BASE}/api/ingest`, {
          method: 'POST',
          body: formData
        });
      } else {
        ingestResp = await fetch(`${API_BASE}/api/ingest`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ bbox, date })
        });
      }
      if (!ingestResp.ok) {
        const txt = await ingestResp.text().catch(() => null);
        throw new Error(`Ingest failed: ${txt || ingestResp.status}`);
      }
      const ingestData = await ingestResp.json();
      const ingestPath: string = ingestData.path || '';
      const ingestFilename = ingestPath.split('/').pop();

      // 2) preprocess
      setAgentStatus(AgentStatus.ORIENTING);
      const preprocessResp = await fetch(`${API_BASE}/api/preprocess`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: ingestFilename, bbox })
      });
      if (!preprocessResp.ok) {
        const txt = await preprocessResp.text().catch(() => null);
        throw new Error(`Preprocess failed: ${txt || preprocessResp.status}`);
      }
      const preprocessData = await preprocessResp.json();
      const processedFilename = preprocessData.outFilename;

      // 3) polygons
      setAgentStatus(AgentStatus.DECIDING);
      const polygonsResp = await fetch(`${API_BASE}/api/polygons`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: processedFilename })
      });
      if (!polygonsResp.ok) {
        const txt = await polygonsResp.text().catch(() => null);
        throw new Error(`Polygons generation failed: ${txt || polygonsResp.status}`);
      }
      const polygonsData = await polygonsResp.json();

      // 4) fetch weather (SINGLE SOURCE OF TRUTH)
      setAgentStatus(AgentStatus.ACTING);
      const weather = await fetchWeatherData(lat, lon).catch(() => null);

      const weatherConfidence = weather && (weather.temperature !== 0 || weather.rainfall !== '0mm') ? 70 : 45;

      // Build polygons for Leaflet (convert lon,lat → lat,lon)
      const collection = polygonsData.collection;
      const floodPolygons: [number, number][][] = [];
      if (collection && collection.features) {
        for (const f of collection.features) {
          if (f.geometry && f.geometry.type === 'Polygon') {
            const ring = f.geometry.coordinates[0].map((c: number[]) => [c[1], c[0]]);
            floodPolygons.push(ring as [number, number][]);
          }
        }
      }

      // Confidence calculations
      const imageryQuality = ingestData.size ? Math.min(100, 30 + (ingestData.size / 5000)) : 65;
      const polygonConfidence = Math.min(90, 40 + (floodPolygons.length * 8));
      const satelliteConfidence = Math.round((imageryQuality + polygonConfidence) / 2);
      const documentConfidence = (ingestData.source ? 40 : 20) + (floodPolygons.length > 0 ? 20 : 0);
      
      const overallConfidence = Math.round(
        (satelliteConfidence * 0.4) + (weatherConfidence * 0.35) + (documentConfidence * 0.25)
      );

      const polygonCount = floodPolygons.length;
      const weatherDesc = weather 
        ? `Conditions: ${weather.temperature}°C, ${weather.rainfall} rainfall, ${weather.windSpeed} ${weather.windDirection} winds.`
        : 'Weather data unavailable.';
      const summary = `Analysis identified ${polygonCount} flood-prone polygon(s) in ${location}. ${weatherDesc} Risk assessment: MEDIUM confidence based on satellite imagery and local climate data.`;
      
      const reasoningTrace = `Step 1: Ingested Sentinel-2 imagery for ${date}. Step 2: Preprocessed to ${weather ? 'luminance-based' : 'binary'} raster. Step 3: Applied marching-squares contour extraction to identify ${polygonCount} distinct flood-risk polygon(s). Step 4: Integrated weather data (${weather?.description || 'unavailable'}) for confidence weighting. Component confidence: Satellite ${satelliteConfidence}%, Weather ${weatherConfidence}%, Policy/Documents ${documentConfidence}%.`;

      const plan: ClimatePlan = {
        id: Math.random().toString(36).substr(2, 9),
        timestamp: new Date().toISOString(),
        location,
        riskLevel: 'MEDIUM',
        summary,
        reasoningTrace,
        overallConfidence,
        weather: weather || { temperature: 0, rainfall: '0mm', windSpeed: 'N/A', windDirection: 'N/A', description: 'Unknown' },
        checklists: [],
        confidenceMetrics: { satellite: satelliteConfidence, weather: weatherConfidence, documents: documentConfidence },
        floodPolygons,
        groundingUrls: ingestData.source ? [{ title: ingestData.source, uri: ingestData.path }] : []
      };

      setActivePlan(plan);

      // 5) Call server for AI-augmented plan (pass weather data)
      try {
        setAgentStatus(AgentStatus.OBSERVING);
        const aiResp = await fetch(`${API_BASE}/api/gemini-plan`, {
          method: 'POST', 
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            location, 
            floodPolygons, 
            weather: plan.weather,
            confidenceMetrics: plan.confidenceMetrics 
          })
        });
        
        if (aiResp.ok) {
          const aiPlan = await aiResp.json();
          setActivePlan(aiPlan);
        } else {
          const txt = await aiResp.text().catch(() => null);
          console.warn('Gemini plan generation failed:', txt || aiResp.status);
          setActivePlan({ ...plan, rawAIResponse: { text: txt || `HTTP ${aiResp.status}`, candidates: null } });
          alert(`Gemini plan generation failed: ${txt || aiResp.status}. Check server logs and ensure GEMINI_API_KEY is configured.`);
        }
      } catch (e: any) {
        console.error('Gemini call failed', e);
        setActivePlan({ ...plan, rawAIResponse: { text: String(e?.message || e), candidates: null } });
        alert(`Gemini call failed: ${String(e?.message || e)}.`);
      }
    } catch (error: any) {
      console.error(error);
      alert(error?.message || 'Operational reasoning failed.');
    } finally {
      setLoading(false);
      setAgentStatus(AgentStatus.IDLE);
    }
  };

  const generateAIPlan = async () => {
    if (!activePlan?.weather) {
      alert('No weather data available. Run analysis first.');
      return;
    }
    
    try {
      setLoading(true);
      setAgentStatus(AgentStatus.OBSERVING);

      const payload = {
        location,
        floodPolygons: activePlan?.floodPolygons || [],
        weather: activePlan?.weather,
        confidenceMetrics: activePlan?.confidenceMetrics || null
      };

      const resp = await fetch(`${API_BASE}/api/gemini-plan`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      
      if (!resp.ok) {
        const txt = await resp.text().catch(() => null);
        throw new Error(`AI generation failed: ${txt || resp.status}`);
      }
      
      const plan = await resp.json();
      setActivePlan(plan);
      setAgentStatus(AgentStatus.IDLE);
      return plan;
    } catch (e: any) {
      console.error('generateAIPlan failed', e);
      alert(e?.message || 'AI generation failed');
    } finally {
      setLoading(false);
    }
  };

  const toggleCrisisMode = () => {
    setIsCrisisEnabled(!isCrisisEnabled);
    if (!isCrisisEnabled && activePlan) {
      setAgentStatus(AgentStatus.RECHECKING);
      setTimeout(() => {
        setActivePlan({
          ...activePlan,
          riskLevel: 'CRITICAL',
          overallConfidence: 98,
          summary: "CRITICAL: Live search alerts indicate flash flooding in multiple sectors. Extreme wind advisory active.",
          weather: {
            ...activePlan.weather,
            windSpeed: '55mph',
            rainfall: '300mm'
          }
        });
        setAgentStatus(AgentStatus.IDLE);
      }, 1500);
    }
  };

  return {
    activePlan,
    agentStatus,
    loading,
    location,
    setLocation,
    selectedImage,
    setSelectedImage,
    isCrisisEnabled,
    mapCenter,
    startAnalysis,
    toggleCrisisMode,
    generateAIPlan,
  };
};