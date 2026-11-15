<template>
  <article class="cam" :class="`is-${phase}`">
    <div class="frame" :style="{ aspectRatio: ratio }">
      <video ref="video" playsinline autoplay muted :class="{ shown: phase === 'live' && playing }" @loadedmetadata="onMeta" @playing="onPlaying" />

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

      <!-- Connected, but no picture yet: iPhone may hold back a video that started without a tap -->
      <div v-if="phase === 'live' && !playing" class="poster">
        <button v-if="needsTap" type="button" class="primary watch" @click="play(true)">{{ m.security.tapToPlay }}</button>
        <p v-else class="msg" role="status">{{ m.security.loadingPicture }}</p>
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

const props = defineProps<{ camera: Camera; autostart?: boolean }>()
const api = useApi()
const { m, serverText } = useLocale()

const video = ref<HTMLVideoElement | null>(null)
const phase = ref<'idle' | 'connecting' | 'live' | 'paused' | 'ended' | 'error'>('idle')
const message = ref(props.camera.live ? '' : m.value.security.notLive)
const muted = ref(true)
const playing = ref(false)
const needsTap = ref(false)
const size = ref(props.camera.resolution)
const ratio = computed(() => (size.value ? `${size.value.width} / ${size.value.height}` : '16 / 9'))
const expiresAt = ref<number | null>(null)
const now = ref(Date.now())

let pc: RTCPeerConnection | null = null
let session: Session | null = null
let extendTimer: ReturnType<typeof setTimeout> | undefined
let clock: ReturnType<typeof setInterval> | undefined
let watchdog: ReturnType<typeof setTimeout> | undefined

// Vue only sets the muted property; iPhone Safari wants the attribute as well before it plays without a tap
watch(muted, (on) => {
  const v = video.value
  if (!v) return
  v.muted = on
  v.toggleAttribute('muted', on)
}, { flush: 'post' })

/**
 * Start the picture ourselves instead of trusting autoplay: a page that starts its cameras by itself has no tap,
 * and iPhone then leaves the video paused on a black frame while the connection is fine. When play() is refused,
 * a tap on the tile starts it (a tap always counts as permission).
 */
function play(byTap = false) {
  const v = video.value
  if (!v || !v.srcObject) return
  v.muted = muted.value
  v.toggleAttribute('muted', muted.value)
  if (byTap) {
    needsTap.value = false
    // Tapped and still black after a while: the picture isn't coming, say so instead of a dark tile
    clearTimeout(watchdog)
    watchdog = setTimeout(() => {
      if (phase.value === 'live' && !playing.value) fail(m.value.security.noPicture, new Error(`no picture after a tap (readyState ${v.readyState})`))
    }, 12_000)
  }
  try {
    v.play().catch((err: any) => {
      if (err?.name === 'NotAllowedError') needsTap.value = true
      else if (err?.name !== 'AbortError') console.warn(`[camera ${props.camera.id}] play`, err)
    })
  } catch {}
}

function onPlaying() {
  playing.value = true
  needsTap.value = false
  clearTimeout(watchdog)
}

/** Connected but still black after a few seconds: offer a tap, which also counts as permission to play */
function watchPicture() {
  clearTimeout(watchdog)
  watchdog = setTimeout(() => {
    if (phase.value === 'live' && !playing.value) needsTap.value = true
  }, 5_000)
}

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
  let conn: RTCPeerConnection | null = null
  try {
    conn = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] })
    pc = conn
    // Google's order: audio, video, then a data channel. Audio only received.
    conn.addTransceiver('audio', { direction: 'recvonly' })
    conn.addTransceiver('video', { direction: 'recvonly' })
    conn.createDataChannel('dataSendChannel')
    const media = new MediaStream()
    const c = conn
    c.ontrack = (e) => {
      if (pc !== c) return
      try {
        media.addTrack(e.track)
        // Audio comes first; hang the stream on the video element once the picture is in it, then play
        if (e.track.kind === 'video' && video.value) {
          if (video.value.srcObject !== media) video.value.srcObject = media
          play()
        }
      } catch (err) {
        fail(m.value.security.failed, err)
      }
    }
    c.onconnectionstatechange = () => {
      if (pc !== c) return
      if (c.connectionState === 'connected') {
        phase.value = 'live'
        play()
        watchPicture()
      }
      if (c.connectionState === 'failed') fail(m.value.security.failed)
    }
    await c.setLocalDescription(await c.createOffer())
    await gathered(c)
    if (pc !== c) return
    const r = await api<Session>(`/api/security/${props.camera.id}/stream`, { method: 'POST', body: { offerSdp: c.localDescription!.sdp } })
    if (pc !== c || c.signalingState === 'closed') {
      // Stopped while waiting: tell the camera too
      sendStop(r.mediaSessionId)
      return
    }
    session = r
    await c.setRemoteDescription({ type: 'answer', sdp: r.answerSdp! })
    schedule(r.expiresAt)
    clock = setInterval(() => (now.value = Date.now()), 15_000)
  } catch (e: any) {
    // A connection closed under us (stopped, page hidden, a newer start) is no error to show
    if (conn && pc !== conn) return
    fail(e?.statusCode === 409 ? m.value.security.offline : serverText(e?.data?.statusMessage) || m.value.security.failed, e)
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
  clearTimeout(watchdog)
  playing.value = false
  needsTap.value = false
  if (session) sendStop(session.mediaSessionId)
  session = null
  expiresAt.value = null
  const old = pc
  pc = null
  // Closing or detaching can throw in Safari when the connection is already half gone; nothing to do about it then
  try {
    old?.close()
  } catch {}
  try {
    if (video.value) video.value.srcObject = null
  } catch {}
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

function fail(text: string, err?: unknown) {
  // Only the tile shows it; the details go to the console (and Sentry) for us
  if (err) console.warn(`[camera ${props.camera.id}]`, err)
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
  // iPhone Safari only has webkitEnterFullscreen on video, and throws when the picture isn't playing yet
  const fallback = () => {
    try {
      v.webkitEnterFullscreen?.()
    } catch {}
  }
  if (v.requestFullscreen) v.requestFullscreen().catch(fallback)
  else fallback()
}

// Nobody watching a hidden page: stop, so the camera doesn't stream to nobody. Back on the page it picks up again
// by itself when the page started it by itself, otherwise it offers to carry on.
function onVisibility() {
  if (document.visibilityState === 'hidden' && (phase.value === 'live' || phase.value === 'connecting')) stop('paused')
  else if (document.visibilityState === 'visible' && phase.value === 'paused' && props.autostart) void start()
}
onMounted(() => {
  document.addEventListener('visibilitychange', onVisibility)
  if (props.autostart && props.camera.live && document.visibilityState === 'visible') void start()
})
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
