/**
 * Which cameras start their live picture by themselves when the Security tab opens. One at most: every stream is
 * its own connection to the camera, and a battery camera pays for each with its charge. So the camera a
 * notification pointed to, else the doorbell (the one you open the tab for), else the first camera. The others
 * wait behind "Watch live".
 */
export function autostartCameras(cameras: Array<{ id: string; kind: string; live: boolean }>, asked: string | null): string[] {
  const live = cameras.filter((c) => c.live)
  const pick = live.find((c) => c.id === asked) ?? live.find((c) => c.kind === 'doorbell') ?? live[0]
  return pick ? [pick.id] : []
}
