/**
 * Open-Meteo's WMO weather codes, grouped into the few kinds Home shows: an icon next to the clock and
 * the weather in the house scene. https://open-meteo.com/en/docs ("WMO Weather interpretation codes")
 */
export type WeatherKind = 'clear' | 'partly' | 'cloudy' | 'fog' | 'drizzle' | 'rain' | 'snow' | 'thunder'

export function weatherKind(code: number): WeatherKind {
  if (code <= 1) return 'clear'
  if (code === 2) return 'partly'
  if (code === 3) return 'cloudy'
  if (code === 45 || code === 48) return 'fog'
  if (code >= 51 && code <= 57) return 'drizzle'
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return 'rain'
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow'
  if (code >= 95) return 'thunder'
  return 'cloudy'
}

/** The icon for a kind; clear and partly cloudy show the moon after sunset */
export function weatherIcon(kind: WeatherKind, night: boolean): string {
  switch (kind) {
    case 'clear': return night ? 'moon' : 'sun'
    case 'partly': return night ? 'cloud-moon' : 'cloud-sun'
    case 'cloudy': return 'cloud'
    case 'fog': return 'cloud-fog'
    case 'drizzle': return 'cloud-drizzle'
    case 'rain': return 'cloud-rain'
    case 'snow': return 'cloud-snow'
    case 'thunder': return 'cloud-bolt'
  }
}

/** Whole degrees, and never "-0°" */
export function degrees(tempC: number): string {
  const r = Math.round(tempC)
  return `${r === 0 ? 0 : r}°`
}
