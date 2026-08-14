import { useState, useEffect } from "react";

export type WeatherData = {
  temperature: number;
  apparentTemp: number;
  humidity: number;
  windSpeed: number;
  condition: string;
  iconName: string;
  cityName: string;
  country: string;
};

export type WeatherStatus = "idle" | "loading" | "ready" | "error";

// Mapa de codigos WMO (Organizacion Meteorologica Mundial) a descripciones
// legibles e iconos Ionicons. Los rangos son acumulativos: si code <= 48
// ya paso los filtros 0 y 3, entonces es niebla. Ver tabla completa en:
// https://open-meteo.com/en/docs#weathervariables
function interpretCode(code: number): { condition: string; iconName: string } {
  if (code === 0) return { condition: "Despejado", iconName: "sunny-outline" };
  if (code <= 3) return { condition: "Parcialmente nublado", iconName: "partly-sunny-outline" };
  if (code <= 48) return { condition: "Niebla", iconName: "cloud-outline" };
  if (code <= 67) return { condition: "Lluvia", iconName: "rainy-outline" };
  if (code <= 77) return { condition: "Nieve", iconName: "snow-outline" };
  if (code <= 82) return { condition: "Chubascos", iconName: "rainy-outline" };
  return { condition: "Tormenta", iconName: "thunderstorm-outline" };
}

type IpGeo = {
  latitude: number;
  longitude: number;
  city: string;
  country: string;
};

// Geolocalizacion por IP (ipwho.is, sin API key) en vez de pedir permiso de
// ubicacion en el dispositivo. Solo se usa para anclar el pronostico; la
// precision a nivel de ciudad es suficiente para el clima.
async function ipGeolocation(fetchFn: typeof fetch = fetch): Promise<IpGeo | null> {
  try {
    const res = await fetchFn("https://ipwho.is/");
    if (!res.ok) return null;
    const json = await res.json();
    if (!json?.success || typeof json.latitude !== "number" || typeof json.longitude !== "number") {
      return null;
    }
    return {
      latitude: json.latitude,
      longitude: json.longitude,
      city: json.city ?? "",
      country: json.country ?? "",
    };
  } catch {
    return null;
  }
}

// Hook que obtiene la ubicacion por IP, consulta Open-Meteo (sin API key) y
// reporta el clima. No solicita permisos de ubicacion. Retorna el estado del
// clima y los datos cuando estan disponibles.
export function useWeather(): { status: WeatherStatus; weather: WeatherData | null } {
  const [status, setStatus] = useState<WeatherStatus>("idle");
  const [weather, setWeather] = useState<WeatherData | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        setStatus("loading");

        const geo = await ipGeolocation();
        if (cancelled) return;
        if (!geo) {
          setStatus("error");
          return;
        }

        const { latitude, longitude } = geo;

        // Open-Meteo no requiere API key. current=temperature_2m,weather_code
        // devuelve solo los datos puntuales del momento actual (no el forecast
        // completo). timezone=auto ajusta la hora a la zona horaria del dispositivo.
        // https://open-meteo.com/en/docs
        const response = await fetch(
          `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,weather_code&timezone=auto`
        );
        if (!response.ok) throw new Error("weather_fetch_failed");
        const json = await response.json();
        if (cancelled) return;

        const temperature = Math.round(json.current.temperature_2m as number);
        const apparentTemp = Math.round(json.current.apparent_temperature as number);
        const humidity = json.current.relative_humidity_2m as number;
        const windSpeed = Math.round(json.current.wind_speed_10m as number);
        const weatherCode = json.current.weather_code as number;
        const { condition, iconName } = interpretCode(weatherCode);

        setWeather({ temperature, apparentTemp, humidity, windSpeed, condition, iconName, cityName: geo.city, country: geo.country });
        setStatus("ready");
      } catch {
        if (!cancelled) setStatus("error");
      }
    }

    load();
    return () => { cancelled = true; };
  }, []);

  return { status, weather };
}