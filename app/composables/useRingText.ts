/** "Doorbell rang at 14:32", "…yesterday at 14:32" or "…on 10 Nov": when the bell last rang, as Home and Security say it */
export function useRingText() {
  const { m, locale } = useLocale()
  return (iso: string, now: string | Date = new Date()) => {
    const at = new Date(iso)
    const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
    const days = Math.round((day(new Date(now)) - day(at)) / 86_400_000)
    if (days <= 0) return m.value.home.rangToday(time(at))
    if (days === 1) return m.value.home.rangYesterday(time(at))
    return m.value.home.rangOn(at.toLocaleDateString(locale.value === 'nl' ? 'nl-NL' : 'en-GB', { day: 'numeric', month: 'short' }))
  }
}
