export interface WeatherData {
  temperature: number;
  rainfall: string;
  windSpeed: string;
  windDirection: string;
  humidity?: number;
  pressure?: number;
  description?: string;
}

const API_BASE = import.meta.env.VITE_WORKER_API || 'http://localhost:4000';

export const fetchWeatherData = async (lat: number, lon: number): Promise<WeatherData> => {
  try {
    const response = await fetch(
      `${API_BASE}/api/weather?lat=${lat}&lon=${lon}`
    );
    
    if (!response.ok) {
      const error = await response.text();
      console.error('Weather proxy error:', error);
      return getPlaceholderData();
    }
    
    return await response.json();
  } catch (err) {
    console.error('Failed to fetch weather:', err);
    return getPlaceholderData();
  }
};

function getPlaceholderData(): WeatherData {
  return {
    temperature: 0,
    rainfall: '0mm',
    windSpeed: 'N/A',
    windDirection: 'N/A',
    description: 'Unknown'
  };
}