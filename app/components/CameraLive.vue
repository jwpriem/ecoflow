<template>
  <article class="cam" :class="phase">
    <div class="frame" :style="{ aspectRatio: ratio }">
      <video ref="video" playsinline autoplay :muted="muted" :class="{ shown: phase === 'live' }" @loadedmetadata="onMeta" />

      <!-- Before, after or between streams: a quiet poster with one call to action -->
      <div v-if="phase !== 'live'" class="poster">
        <div v-if="phase === 'connecting'" class="skeleton fill" aria-hidden="true" />
        <AppIcon :name="camera.kind === 'doorbell' ? 'bell' : 'camera'" class="mark" />
        <p v-if="message" class="msg" role="status">{{ message }}</p>
        <button v-if="camera.live && phase !== 'connecting'" type="button" class="primary watch" @click="start">
          {{ phase === 'paused' ? m.security.resume : m.security.watch }}
        </button>
        <p v-else-if="phase === 'connecting'" class="msg">{{ m.security.connecting }}</p>
      </div>

      <!-- On top of the live picture -->
      <template v-if="phase === 'live'">
        <span class="badge"><span class="dot live" />{{ m.security.live }}<template v-if="minutesLeft !== null"> · {{ m.security.timeLeft(minutesLeft) }}</template></span>
        <div class="controls">
          <button type="button" class="ctl" :aria-label="muted ? m.security.sound : m.security.mute" :aria-pressed="!muted" @click="muted = !muted">
            <AppIcon :name="muted ? 'speaker-off' : 'speaker'" />
          </button>
          <button type="button" class="ctl" :aria-label="m.security.fullscreen" @click="fullscreen"><AppIcon name="expand" /></button>
          <button type="button" class="ctl stop" @click="stop()">{{ m.security.stop }}</button>
        </div>
      </template>
    </div>
    <header class="cap">
      <span class="name">{{ camera.name }}</span>
      <span class="sub">{{ m.security.kind[camera.kind] }}<template v-if="camera.room && camera.room !== camera.name"> · {{ camera.room }}</template></span>
    </header>
  </article>
</template>

<script setup lang="ts">
export type Camera = {
  id: string
  name: string
  room: string | null
  kind: 'doorbell' | 'camera' | 'display'
  live: boolean
  resolution: { width: number; height: number } | null
  extendable: boolean
}
type Session = { answerSdp?: string; mediaSessionId: string; expiresAt: string }

const props = defineProps<{ camera: Camera }>()
const api = useApi()
const { m, serverText } = useLocale()

const video = ref<HTMLVideoElement | null>(null)
const phase = ref<'idle' | 'connecting' | 'live' | 'paused' | 'ended' | 'error'>('idle')
const message = ref(props.camera.live ? '' : m.value.security.notLive)
const muted = ref(true)
const size = ref(props.camera.resolution)
const ratio = computed(() => (size.value ? `${size.value.width} / ${size.value.height}` : '16 / 9'))
const expiresAt = ref<number | null>(null)
const now = ref(Date.now())

let pc: RTCPeerConnection | null = null
let session: Session | null = null
let extendTimer: ReturnType<typeof setTimeout> | undefined
let clock: ReturnType<typeof setInterval> | undefined

// Battery cameras stop after 5 minutes; wired ones are extended quietly, so no countdown for those
const minutesLeft = computed(() => (props.camera.extendable || !expiresAt.value ? null : Math.max(1, Math.ceil((expiresAt.value - now.value) / 60_000))))

/** Google takes no trickled candidates, so the offer goes out with what was gathered in a short moment */
function gathered(conn: RTCPeerConnection, ms = 1200) {
  if (conn.iceGatheringState === 'complete') return Promise.resolve()
  return new Promise<void>((resolve) => {
    const done = () => {
      conn.removeEventListener('icegatheringstatechange', check)
      resolve()
    }
    const check = () => conn.iceGatheringState === 'complete' && done()
    conn.addEventListener('icegatheringstatechange', check)
    setTimeout(done, ms)
  })
}

async function start() {
  teardown()
  phase.value = 'connecting'
  message.value = ''
  const conn = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] })
  pc = conn
  try {
    // Google's order: audio, video, then a data channel. Audio only received.
    conn.addTransceiver('audio', { direction: 'recvonly' })
    conn.addTransceiver('video', { direction: 'recvonly' })
    conn.createDataChannel('dataSendChannel')
    const media = new MediaStream()
    conn.ontrack = (e) => {
      media.addTrack(e.track)
      if (video.value && video.value.srcObject !== media) video.value.srcObject = media
    }
    conn.onconnectionstatechange = () => {
      if (pc !== conn) return
      if (conn.connectionState === 'connected') phase.value = 'live'
      if (conn.connectionState === 'failed') fail(m.value.security.failed)
    }
    await conn.setLocalDescription(await conn.createOffer())
    await gathered(conn)
    if (pc !== conn) return
    const r = await api<Session>(`/api/security/${props.camera.id}/stream`, { method: 'POST', body: { offerSdp: conn.localDescription!.sdp } })
    if (pc !== conn) {
      // Stopped while waiting: tell the camera too
      sendStop(r.mediaSessionId)
      return
    }
    session = r
    await conn.setRemoteDescription({ type: 'answer', sdp: r.answerSdp! })
    schedule(r.expiresAt)
    clock = setInterval(() => (now.value = Date.now()), 15_000)
  } catch (e: any) {
    if (pc !== conn) return
    fail(e?.statusCode === 409 ? m.value.security.offline : serverText(e?.data?.statusMessage) || m.value.security.failed)
  }
}

/** Streams last 5 minutes. A wired camera gets another 5 a minute before; a battery one ends. */
function schedule(iso: string) {
  clearTimeout(extendTimer)
  const at = Date.parse(iso) || Date.now() + 5 * 60_000
  expiresAt.value = at
  if (!props.camera.extendable) {
    extendTimer = setTimeout(() => end(m.value.security.ended), Math.max(0, at - Date.now()))
    return
  }
  extendTimer = setTimeout(extend, Math.max(5_000, at - Date.now() - 60_000))
}

async function extend() {
  if (!session) return
  try {
    const r = await api<Session>(`/api/security/${props.camera.id}/extend`, { method: 'POST', body: { mediaSessionId: session.mediaSessionId } })
    if (!session) return
    session = { ...session, ...r }
    schedule(r.expiresAt)
  } catch {
    end(m.value.security.ended)
  }
}

function sendStop(mediaSessionId: string) {
  api(`/api/security/${props.camera.id}/stop`, { method: 'POST', body: { mediaSessionId } }).catch(() => undefined)
}

/** Close the connection and let the camera know; the poster comes back */
function teardown() {
  clearTimeout(extendTimer)
  clearInterval(clock)
  if (session) sendStop(session.mediaSessionId)
  session = null
  expiresAt.value = null
  pc?.close()
  pc = null
  if (video.value) video.value.srcObject = null
}

function stop(next: 'idle' | 'paused' = 'idle') {
  teardown()
  phase.value = next
  message.value = ''
}

function end(text: string) {
  teardown()
  phase.value = 'ended'
  message.value = text
}

function fail(text: string) {
  teardown()
  phase.value = 'error'
  message.value = text
  haptic('error')
}

function onMeta() {
  const v = video.value
  if (v?.videoWidth && v.videoHeight) size.value = { width: v.videoWidth, height: v.videoHeight }
}

function fullscreen() {
  const v = video.value as (HTMLVideoElement & { webkitEnterFullscreen?: () => void }) | null
  if (!v) return
  if (v.requestFullscreen) v.requestFullscreen().catch(() => v.webkitEnterFullscreen?.())
  else v.webkitEnterFullscreen?.()
}

// Nobody watching a hidden page: stop, so the camera doesn't stream to nobody, and offer to carry on
function onVisibility() {
  if (document.visibilityState === 'hidden' && (phase.value === 'live' || phase.value === 'connecting')) stop('paused')
}
onMounted(() => document.addEventListener('visibilitychange', onVisibility))
onBeforeUnmount(() => {
  document.removeEventListener('visibilitychange', onVisibility)
  teardown()
})
</script>

<style scoped>
.cam { min-width: 0; }
/* The picture is always dark, day or night: a camera feed on cream looks like a hole */
.frame {
  position: relative; overflow: hidden; border-radius: var(--radius); background: #0b132b; color: #f4eee6;
  max-height: 72vh; margin-inline: auto; transition: aspect-ratio var(--dur-3) var(--ease-out);
}
video { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; opacity: 0; transition: opacity var(--dur-4) var(--ease-out); }
video.shown { opacity: 1; }
.poster { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; padding: 16px; text-align: center; }
.skeleton.fill { position: absolute; inset: 0; border-radius: 0; opacity: 0.25; }
.mark { width: 34px; height: 34px; opacity: 0.55; position: relative; }
.msg { margin: 0; font-size: 14px; color: rgba(244, 238, 230, 0.78); max-width: 34ch; position: relative; }
.watch { position: relative; border-radius: 999px; padding: 9px 18px; font-weight: 600; transition: transform var(--dur-1) var(--ease-out); }
.watch:active { transform: scale(0.97); }
.badge {
  position: absolute; top: 10px; left: 10px; display: inline-flex; align-items: center; gap: 7px; padding: 5px 10px;
  border-radius: 999px; background: rgba(11, 19, 43, 0.62); backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
  font-size: 12px; font-weight: 600; letter-spacing: 0.02em; font-variant-numeric: tabular-nums; animation: settle var(--dur-3) var(--ease-out);
}
.controls { position: absolute; right: 10px; bottom: 10px; display: flex; gap: 8px; animation: settle var(--dur-3) var(--ease-out); }
.ctl {
  display: inline-flex; align-items: center; justify-content: center; min-width: 38px; height: 38px; padding: 0 10px; border-radius: 999px;
  border: 0; background: rgba(11, 19, 43, 0.62); color: #f4eee6; backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); font-size: 13px; font-weight: 600;
}
.ctl:hover { background: rgba(11, 19, 43, 0.8); }
.ctl svg { width: 18px; height: 18px; }
.ctl.stop { padding: 0 14px; }
.cap { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; padding: 10px 2px 0; }
.name { font-size: 16px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sub { font-size: 13px; color: var(--text-2); white-space: nowrap; }
@media (prefers-reduced-motion: reduce) {
  video, .frame { transition: none; }
}
</style>
