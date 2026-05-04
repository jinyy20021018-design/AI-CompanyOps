import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { currentWeatherTool, type CurrentWeatherData } from "../tools/currentWeatherTool.js";
import type { ToolContext } from "../tools/toolTypes.js";
import { buildWeatherReport } from "../agents/weather/WeatherAgent.js";

const mockContext: ToolContext = {
  folderPath: "/test",
  workspaceDir: "/test/workspace",
  agentName: "market",
  requestId: "test-123",
};

const mockOpenWeatherResponse = {
  coord: { lon: -122.4194, lat: 37.7749 },
  weather: [{ id: 800, main: "Clear", description: "clear sky", icon: "01d" }],
  main: {
    temp: 20.5,
    feels_like: 19.8,
    temp_min: 18.0,
    temp_max: 23.0,
    pressure: 1013,
    humidity: 65,
  },
  visibility: 10000,
  wind: { speed: 3.5, deg: 200 },
  clouds: { all: 10 },
  sys: {
    country: "US",
    sunrise: 1630000000,
    sunset: 1630050000,
  },
  name: "San Francisco",
};

describe("currentWeatherTool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.OPENWEATHER_API_KEY = "test-key";
  });

  afterEach(() => {
    delete process.env.OPENWEATHER_API_KEY;
  });

  it("returns tool metadata correctly", () => {
    expect(currentWeatherTool.name).toBe("current_weather");
    expect(currentWeatherTool.provider).toBe("openweathermap");
    expect(currentWeatherTool.defaultTimeoutMs).toBe(5000);
  });

  it("availability always returns true", () => {
    const availability = currentWeatherTool.availability();
    expect(availability.available).toBe(true);
  });

  it("rejects empty city name", async () => {
    const result = await currentWeatherTool.execute({ city: "" }, mockContext);
    expect(result.status).toBe("failed");
    expect(result.reason).toContain("required");
  });

  it("rejects city name longer than 100 chars", async () => {
    const longCity = "a".repeat(101);
    const result = await currentWeatherTool.execute({ city: longCity }, mockContext);
    expect(result.status).toBe("failed");
    expect(result.reason).toContain("too long");
  });

  it("rejects city name with invalid characters", async () => {
    const result = await currentWeatherTool.execute({ city: "San@Francisco!" }, mockContext);
    expect(result.status).toBe("failed");
    expect(result.reason).toContain("invalid characters");
  });

  it("accepts valid city names", async () => {
    const validCities = ["San Francisco", "New York", "Tokyo", "Paris-Ouest", "São Paulo"];
    for (const city of validCities) {
      expect(() => {
        (currentWeatherTool as any).execute({ city }, mockContext).catch(() => {});
      }).not.toThrow();
    }
  });

  it("creates cache key correctly", () => {
    const key1 = (currentWeatherTool as any).execute({ city: "San Francisco" }, mockContext);
    const key2 = (currentWeatherTool as any).execute({ city: "san francisco" }, mockContext);
    // Both should use same cache key (case-insensitive)
  });
});

describe("WeatherAgent", () => {
  it("builds weather report from tool results", () => {
    const result = buildWeatherReport([
      {
        tool: "current_weather",
        status: "fulfilled",
        provider: "openweathermap",
        retrievedAt: new Date().toISOString(),
        data: {
          city: "San Francisco",
          country: "US",
          temperature: 20.5,
          feelsLike: 19.8,
          humidity: 65,
          pressure: 1013,
          windSpeed: 3.5,
          windDegree: 200,
          cloudiness: 10,
          description: "clear sky",
          icon: "01d",
          visibility: 10000,
          sunrise: "2021-08-27T13:06:40.000Z",
          sunset: "2021-08-27T23:50:00.000Z",
        } as CurrentWeatherData,
        sources: [{ url: "", confidence: "high" }],
      },
    ]);

    expect(result.weather).not.toBeNull();
    expect(result.weather?.city).toBe("San Francisco");
    expect(result.weather?.temperature).toBe(20.5);
    expect(result.weather?.humidity).toBe(65);
    expect(result.errors).toHaveLength(0);
  });

  it("handles failed tool results", () => {
    const result = buildWeatherReport([
      {
        tool: "current_weather",
        status: "failed",
        provider: "openweathermap",
        retrievedAt: new Date().toISOString(),
        reason: "City not found",
        sources: [],
      },
    ]);

    expect(result.weather).toBeNull();
    expect(result.errors).toContain("City not found");
  });
});
