/** One line on what a car is doing, and its class: shared by the Cars page and the home summary. */
export function useCarStatus() {
  const { m } = useLocale()
  function carStatus(c: any): { text: string; cls: string } {
    const t = m.value.cars
    const s = c.state ?? {}
    if (s.soc == null) return { text: t.asleep, cls: '' }
    if (s.charging) return { text: s.chargePowerW ? t.chargingAt(watt(s.chargePowerW)) : t.charging, cls: 'charging' }
    if (s.pluggedIn) return { text: t.plugged, cls: 'plugged' }
    return { text: t.idle, cls: '' }
  }
  return { carStatus }
}
