import type { InjectedToolResult } from "../../tools/toolTypes.js";
import type { CurrentWeatherData } from "../../tools/currentWeatherTool.js";

export type WeatherReport = {
  generatedAt: string;
  weather: {
    city: string;
    country: string;
    temperature: number;
    humidity: number;
    windSpeed: number;
    conditions: string;
  } | null;
  errors: string[];
};

export function buildWeatherReport(results: InjectedToolResult[]): WeatherReport {
  const weatherResults = results.filter((r) => r.tool === "current_weather");

  if (weatherResults.length === 0) {
    return {
      generatedAt: new Date().toISOString(),
      weather: null,
      errors: ["No weather data requested"],
    };
  }

  const errors: string[] = [];
  let weather: WeatherReport["weather"] = null;

  for (const result of weatherResults) {
    if (result.status === "fulfilled" && result.data) {
      const data = result.data as CurrentWeatherData;
      weather = {
        city: data.city,
        country: data.country,
        temperature: data.temperature,
        humidity: data.humidity,
        windSpeed: data.windSpeed,
        conditions: data.description,
      };
    } else {
      errors.push(result.reason || `${result.tool}: ${result.status}`);
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    weather,
    errors,
  };
}
