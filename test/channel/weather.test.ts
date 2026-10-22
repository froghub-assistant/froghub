import { afterEach, beforeAll, describe, expect, spyOn, test } from 'bun:test'
import { writeFileSync } from 'fs'
import { join } from 'path'
import { getWeather } from '../../channel/weather.ts'
import { CONFIG } from '../helpers.ts'

// Open-Meteo's answer, cut down to what getWeather reads: now, 48 hours and 7 days from Friday 23 October.
const days = Array.from({ length: 7 }, (_, i) => `2026-10-${23 + i}`)
const hours = days.slice(0, 2).flatMap(d => Array.from({ length: 24 }, (_, h) => `${d}T${String(h).padStart(2, '0')}:00`))
const FORECAST = {
  current: { time: '2026-10-23T14:15', temperature_2m: 12.6, apparent_temperature: 10.4, weather_code: 61, wind_speed_10m: 11.2, precipitation: 0.3 },
  hourly: {
    time: hours,
    temperature_2m: hours.map((_, i) => 8 + (i % 24) / 4),
    weather_code: hours.map(() => 3),
    precipitation_probability: hours.map(() => 40),
  },
  daily: {
    time: days,
    weather_code: [61, 0, 95, 71, 2, 3, 1234],
    temperature_2m_max: days.map(() => 13.4),
    temperature_2m_min: days.map(() => 6.5),
    precipitation_probability_max: days.map(() => 70),
    sunrise: days.map(d => `${d}T07:31`),
    sunset: days.map(d => `${d}T17:52`),
  },
}

let urls: URL[] = []
function openMeteo(body: unknown = FORECAST, status = 200) {
  urls = []
  spyOn(globalThis, 'fetch').mockImplementation((async (url: URL) => {
    urls.push(new URL(url))
    return Response.json(body, { status })
  }) as unknown as typeof fetch)
}

beforeAll(() => writeFileSync(join(CONFIG, 'weather.json'), JSON.stringify({ latitude: 51.5, longitude: -0.13 })))
afterEach(() => {
  ;(globalThis.fetch as unknown as { mockRestore?: () => void }).mockRestore?.()
})

describe('get_weather', () => {
  test("asks for the house's place and time zone", async () => {
    openMeteo()
    await getWeather({})
    const params = urls[0].searchParams
    expect(urls[0].origin + urls[0].pathname).toBe('https://api.open-meteo.com/v1/forecast')
    expect(params.get('latitude')).toBe('51.5')
    expect(params.get('longitude')).toBe('-0.13')
    expect(params.get('timezone')).toBe('Europe/London')
    expect(params.get('wind_speed_unit')).toBe('mph')
  })

  test('now and three days, in words', async () => {
    openMeteo()
    expect(await getWeather({})).toBe([
      'Now (14:15): light rain, 13°C (feels like 10°C), wind 11 mph, 0.3 mm of rain this hour',
      'Days:',
      '  Today: light rain, high 13°C, low 7°C, 70% chance of rain, sunrise 07:31, sunset 17:52',
      '  Tomorrow: clear, high 13°C, low 7°C, 70% chance of rain, sunrise 07:31, sunset 17:52',
      '  Sunday: thunderstorms, high 13°C, low 7°C, 70% chance of rain, sunrise 07:31, sunset 17:52',
    ].join('\n'))
  })

  test('between 1 and 7 days, always fetching at least 2', async () => {
    openMeteo()
    const one = await getWeather({ days: 1 })
    expect(one).not.toContain('Tomorrow')
    expect(urls[0].searchParams.get('forecast_days')).toBe('2')
    const week = await getWeather({ days: 30 })
    expect(week.split('\n').filter(l => l.startsWith('  '))).toHaveLength(7)
    expect(week).toContain('Thursday: unknown') // a weather code it doesn't know
    expect(urls[1].searchParams.get('forecast_days')).toBe('7')
  })

  test('hour by hour, from this hour, for 24 hours', async () => {
    openMeteo()
    const lines = (await getWeather({ hourly: true, days: 1 })).split('\n')
    const hourly = lines.slice(lines.indexOf('Next 24 hours:') + 1, lines.indexOf('Days:'))
    expect(hourly).toHaveLength(24)
    expect(hourly[0]).toBe('  10-23 14:00: cloudy, 12°C, 40% chance of rain')
    expect(hourly.at(-1)).toStartWith('  10-24 13:00:')
  })

  test('no rain this hour is left out', async () => {
    openMeteo({ ...FORECAST, current: { ...FORECAST.current, precipitation: 0 } })
    expect((await getWeather({})).split('\n')[0]).toBe('Now (14:15): light rain, 13°C (feels like 10°C), wind 11 mph')
  })

  test('an error from Open-Meteo is passed on', async () => {
    openMeteo({}, 503)
    await expect(getWeather({})).rejects.toThrow('Open-Meteo said 503')
  })
})
