export interface WeatherData {
  temperature: number;
  rainfall: string;
  windSpeed: string;
  windDirection: string;
  humidity?: number;
  pressure?: number;
  description?: string;
}

export const fetchWeatherData = async (location: string): Promise<WeatherData> => {
  // Vite exposes env vars via import.meta.env with the VITE_ prefix
  const apiKey = (import.meta as any).env?.VITE_OPENWEATHER_API_KEY;

  if (!apiKey) {
    console.warn('OpenWeather API key not configured (VITE_OPENWEATHER_API_KEY). Returning placeholder data.');
    return {
      temperature: 0,
      rainfall: '0mm',
      windSpeed: 'N/A',
      windDirection: 'N/A'
    };
  }

  try {
    const weatherUrl = `https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(location)}&appid=${apiKey}&units=metric`;
    const weatherResponse = await fetch(weatherUrl);
    if (!weatherResponse.ok) {
      console.error('OpenWeather API returned', weatherResponse.status, await weatherResponse.text());
      return {
        temperature: 0,
        rainfall: '0mm',
        windSpeed: 'N/A',
        windDirection: 'N/A'
      };
    }

    const weatherData = await weatherResponse.json();
    const windDegrees = (weatherData.wind && weatherData.wind.deg) || 0;
    const directions = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
    const windDirectionIndex = Math.round(windDegrees / 22.5) % 16;
    const windDirection = directions[windDirectionIndex];

    const rainfall = weatherData.rain?.['1h'] ? `${Math.round(weatherData.rain['1h'] * 10) / 10}mm` : '0mm';

    return {
      temperature: Math.round(weatherData.main.temp),
      rainfall,
      windSpeed: `${Math.round(weatherData.wind?.speed || 0)} m/s`,
      windDirection,
      humidity: weatherData.main?.humidity,
      pressure: weatherData.main?.pressure,
      description: weatherData.weather?.[0]?.main || 'Unknown'
    };
  } catch (err) {
    console.error('Failed to fetch weather data:', err);
    return {
      temperature: 0,
      rainfall: '0mm',
      windSpeed: 'N/A',
      windDirection: 'N/A'
    };
  }
};
