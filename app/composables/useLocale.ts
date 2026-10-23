import { en, type Messages } from '~/i18n/en'
import { nl } from '~/i18n/nl'
import { translateReason } from '~/i18n/reasons'

export type Locale = 'en' | 'nl'

const KEY = 'app.locale'
const DICT: Record<Locale, Messages> = { en, nl }

/** The choices in Settings, each in its own language */
export const LANGUAGES: { value: Locale; label: string }[] = [
  { value: 'nl', label: 'Nederlands' },
  { value: 'en', label: 'English' },
]

function read(): Locale {
  try {
    const v = localStorage.getItem(KEY)
    if (v === 'en' || v === 'nl') return v
  } catch {
    // Storage blocked: fall back to the default
  }
  return 'nl'
}

/**
 * The app's language, stored on this device like the other display settings. Dutch by default.
 * `m` holds the texts of the current language; `reason` and `serverText` translate the plan's
 * explanations and the server's messages, which arrive in English.
 */
export function useLocale() {
  const locale = useState<Locale>('locale', read)
  const m = computed(() => DICT[locale.value])
  decimalComma.value = locale.value === 'nl'

  function setLocale(l: Locale) {
    locale.value = l
    decimalComma.value = l === 'nl'
    try {
      localStorage.setItem(KEY, l)
    } catch {
      // Private mode or storage blocked: the choice still holds for this session
    }
  }

  const reason = (r: string | null | undefined) => translateReason(r, locale.value)
  const serverText = (msg: string | null | undefined) => (msg ? (m.value.server[msg] ?? msg) : '')
  /** Today, Tomorrow, Yesterday or the weekday */
  function dayLabel(d: string | Date, now: number | Date = Date.now()) {
    const diff = dayOffset(d, now)
    if (diff === 0) return m.value.day.today
    if (diff === 1) return m.value.day.tomorrow
    if (diff === -1) return m.value.day.yesterday
    return new Date(d).toLocaleDateString(m.value.dateLocale, { weekday: 'long' })
  }

  return { locale, m, setLocale, reason, serverText, dayLabel }
}

/** Whole days between the dates, in local time: 0 today, 1 tomorrow */
export function dayOffset(d: string | Date, now: number | Date = Date.now()) {
  const day = new Date(d)
  day.setHours(0, 0, 0, 0)
  const today = new Date(now)
  today.setHours(0, 0, 0, 0)
  return Math.round((day.getTime() - today.getTime()) / 86_400_000)
}
