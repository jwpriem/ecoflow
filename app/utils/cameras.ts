/**
 * Which cameras start their live picture by themselves when the Security tab opens. Every wired camera: its stream
 * costs nothing and is kept going quietly. A battery camera pays for each stream with its charge, so it waits
 * behind "Watch live", unless a notification pointed to it, or the house has no wired camera at all: then one
 * starts, the doorbell before any other.
 */
export function autostartCameras(cameras: Array<{ id: string; kind: string; live: boolean; extendable: boolean }>, asked: string | null): string[] {
  const live = cameras.filter((c) => c.live)
  const wired = live.filter((c) => c.extendable)
  const one = live.find((c) => c.id === asked) ?? (wired.length ? undefined : (live.find((c) => c.kind === 'doorbell') ?? live[0]))
  return live.filter((c) => c.extendable || c === one).map((c) => c.id)
}
