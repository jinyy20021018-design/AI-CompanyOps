import { fetchJson, ToolTimeoutError } from "./httpClient.js";
import type { AgentTool, InjectedToolResult, ToolContext } from "./toolTypes.js";

export type CurrentWeatherInput = {
  city: string;
  countryCode?: string;
};

export type CurrentWeatherData = {
  city: string;
  country: string;
  temperature: number;
  feelsLike: number;
  humidity: number;
  pressure: number;
  windSpeed: number;
  windDegree: number;
  cloudiness: number;
  description: string;
  icon: string;
  visibility: number;
  sunrise: string;
  sunset: string;
};

type OpenWeatherResponse = {
  coord: { lon: number; lat: number };
  weather: Array<{ id: number; main: string; description: string; icon: string }>;
  main: {
    temp: number;
    feels_like: number;
    temp_min: number;
    temp_max: number;
    pressure: number;
    humidity: number;
  };
  visibility: number;
  wind: { speed: number; deg: number };
  clouds: { all: number };
  sys: { country: string; sunrise: number; sunset: number };
  name: string;
};

const CACHE_TTL_MS = 30 * 60 * 1000;
const MAX_CACHE_ENTRIES = 1000;

const cache = new Map<string, { data: CurrentWeatherData; timestamp: number }>();

function validateCityInput(city: string): string {
  if (!city || typeof city !== "string") throw new Error("City name is required");
  if (city.length > 100) throw new Error("City name too long (max 100 chars)");
  if (!/^[a-zA-Z0-9\s\-,]*$/.test(city)) throw new Error("City name contains invalid characters");
  return city.trim();
}

function getCacheKey(city: string, countryCode?: string): string {
  return countryCode ? `${city},${countryCode}`.toLowerCase() : city.toLowerCase();
}

function isCacheValid(timestamp: number): boolean {
  return Date.now() - timestamp < CACHE_TTL_MS;
}

function getFromCache(cacheKey: string): CurrentWeatherData | null {
  const entry = cache.get(cacheKey);
  if (entry && isCacheValid(entry.timestamp)) {
    return entry.data;
  }
  if (entry) cache.delete(cacheKey);
  return null;
}

function addToCache(cacheKey: string, data: CurrentWeatherData): void {
  if (cache.size >= MAX_CACHE_ENTRIES) {
    const firstKey = cache.keys().next().value;
    if (firstKey) cache.delete(firstKey);
  }
  cache.set(cacheKey, { data, timestamp: Date.now() });
}

function mapOpenWeatherResponse(data: OpenWeatherResponse): CurrentWeatherData {
  return {
    city: data.name,
    country: data.sys.country,
    temperature: Math.round(data.main.temp * 10) / 10,
    feelsLike: Math.round(data.main.feels_like * 10) / 10,
    humidity: data.main.humidity,
    pressure: data.main.pressure,
    windSpeed: Math.round(data.wind.speed * 100) / 100,
    windDegree: data.wind.deg,
    cloudiness: data.clouds.all,
    description: data.weather[0]?.description || "Unknown",
    icon: data.weather[0]?.icon || "",
    visibility: data.visibility,
    sunrise: new Date(data.sys.sunrise * 1000).toISOString(),
    sunset: new Date(data.sys.sunset * 1000).toISOString(),
  };
}

export const currentWeatherTool: AgentTool<CurrentWeatherInput, CurrentWeatherData> = {
  name: "current_weather",
  provider: "openweathermap",
  description: "Fetch current weather conditions for a city by name.",
  defaultTimeoutMs: 5000,

  availability() {
    return { available: true };
  },

  async execute(input: CurrentWeatherInput, _ctx: ToolContext): Promise<InjectedToolResult<CurrentWeatherData>> {
    try {
      const city = validateCityInput(input.city);
      const cacheKey = getCacheKey(city, input.countryCode);

      const cached = getFromCache(cacheKey);
      if (cached) {
        return {
          tool: this.name,
          status: "fulfilled",
          provider: this.provider,
          retrievedAt: new Date().toISOString(),
          data: cached,
          sources: [{ title: `Weather for ${city} (cached)`, url: "", confidence: "high" }],
        };
      }

      const query = input.countryCode ? `${city},${input.countryCode}` : city;
      const url = `https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(query)}&units=metric&appid=${process.env.OPENWEATHER_API_KEY || ""}`;

      const openWeatherData = await fetchJson<OpenWeatherResponse>(url, { timeoutMs: this.defaultTimeoutMs });
      const mappedData = mapOpenWeatherResponse(openWeatherData);
      addToCache(cacheKey, mappedData);

      return {
        tool: this.name,
        status: "fulfilled",
        provider: this.provider,
        retrievedAt: new Date().toISOString(),
        data: mappedData,
        sources: [{ title: `Current weather for ${city}`, url, confidence: "high" }],
      };
    } catch (err) {
      const isTimeout = err instanceof ToolTimeoutError;
      const reason = err instanceof Error ? err.message : String(err);

      if (reason.includes("401") || reason.includes("Invalid API key")) {
        return {
          tool: this.name,
          status: "failed",
          provider: this.provider,
          retrievedAt: new Date().toISOString(),
          reason: "API key not configured",
          sources: [],
        };
      }

      if (reason.includes("404") || reason.includes("not found")) {
        return {
          tool: this.name,
          status: "failed",
          provider: this.provider,
          retrievedAt: new Date().toISOString(),
          reason: `City "${input.city}" not found`,
          sources: [],
        };
      }

      if (reason.includes("429")) {
        return {
          tool: this.name,
          status: "failed",
          provider: this.provider,
          retrievedAt: new Date().toISOString(),
          reason: "API rate limit reached",
          sources: [],
        };
      }

      return {
        tool: this.name,
        status: isTimeout ? "timeout" : "failed",
        provider: this.provider,
        retrievedAt: new Date().toISOString(),
        reason,
        sources: [],
      };
    }
  },
};
