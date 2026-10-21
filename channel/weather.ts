/**
 * The get_weather tool: Open-Meteo (free, no key) for the home's rough location, which lives in
 * ~/.config/froghub/weather.json as { "latitude": 51.5, "longitude": -0.13 } (two decimals, about a kilometre).
 */
import { readFileSync } from 'fs'
import { homedir } from 'os'
import { instance } from './instance.ts'

const CONFIG = `${homedir()}/.config/froghub/weather.json`

// WMO weather codes, as Open-Meteo reports them.
const WORDS: Record<number, string> = {
  0: 'clear', 1: 'mostly clear', 2: 'partly cloudy', 3: 'cloudy', 45: 'foggy', 48: 'foggy and frosty',
  51: 'light drizzle', 53: 'drizzle', 55: 'heavy drizzle', 56: 'freezing drizzle', 57: 'freezing drizzle',
  61: 'light rain', 63: 'rain', 65: 'heavy rain', 66: 'freezing rain', 67: 'freezing rain',
  71: 'light snow', 73: 'snow', 75: 'heavy snow', 77: 'snow grains',
  80: 'light showers', 81: 'showers', 82: 'heavy showers', 85: 'snow showers', 86: 'heavy snow showers',
  95: 'thunderstorms', 96: 'thunderstorms with hail', 99: 'thunderstorms with hail',
}
const words = (code: number) => WORDS[code] ?? 'unknown'

export const weatherTool = {
  name: 'get_weather',
  description:
    'The weather at home right now, and the forecast: hour by hour for today and tomorrow, or day by day for up to a week. ' +
    'Use it for anything about the weather, what to wear, rain, snow, sunrise or sunset.',
  inputSchema: {
    type: 'object',
    properties: {
      days: { type: 'number', description: 'Days of daily forecast, 1-7 (default 3)' },
      hourly: { type: 'boolean', description: 'Also give the next 24 hours, hour by hour (e.g. "will it rain this afternoon?")' },
    },
  },
}

export async function getWeather(args: { days?: unknown; hourly?: unknown }): Promise<string> {
  const { latitude, longitude } = JSON.parse(readFileSync(CONFIG, 'utf8'))
  const days = Math.max(1, Math.min(7, Math.round(Number(args.days) || 3)))
  const url = new URL('https://api.open-meteo.com/v1/forecast')
  url.search = new URLSearchParams({
    latitude: String(latitude),
    longitude: String(longitude),
    timezone: instance.timeZone,
    forecast_days: String(Math.max(days, 2)),
    current: 'temperature_2m,apparent_temperature,weather_code,wind_speed_10m,precipitation',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset',
    hourly: 'temperature_2m,weather_code,precipitation_probability',
    wind_speed_unit: 'mph',
  }).toString()
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) })
  if (!res.ok) throw new Error(`Open-Meteo said ${res.status}`)
  const w = await res.json()

  const c = w.current
  const lines = [
    `Now (${c.time.slice(11)}): ${words(c.weather_code)}, ${Math.round(c.temperature_2m)}°C ` +
      `(feels like ${Math.round(c.apparent_temperature)}°C), wind ${Math.round(c.wind_speed_10m)} mph` +
      (c.precipitation > 0 ? `, ${c.precipitation} mm of rain this hour` : ''),
  ]
  if (args.hourly) {
    const from = w.hourly.time.findIndex((t: string) => t >= c.time.slice(0, 13))
    lines.push('Next 24 hours:')
    for (let i = Math.max(0, from); i < Math.min(from + 24, w.hourly.time.length); i++) {
      lines.push(`  ${w.hourly.time[i].slice(5).replace('T', ' ')}: ${words(w.hourly.weather_code[i])}, ` +
        `${Math.round(w.hourly.temperature_2m[i])}°C, ${w.hourly.precipitation_probability[i]}% chance of rain`)
    }
  }
  lines.push('Days:')
  for (let i = 0; i < days; i++) {
    const d = w.daily
    const name = i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : new Date(d.time[i]).toLocaleDateString('en-GB', { weekday: 'long' })
    lines.push(`  ${name}: ${words(d.weather_code[i])}, high ${Math.round(d.temperature_2m_max[i])}°C, ` +
      `low ${Math.round(d.temperature_2m_min[i])}°C, ${d.precipitation_probability_max[i]}% chance of rain, ` +
      `sunrise ${d.sunrise[i].slice(11)}, sunset ${d.sunset[i].slice(11)}`)
  }
  return lines.join('\n')
}
