import { soundByToken } from '../../../../services/sonos'

/**
 * The Sonos speaker fetches an uploaded doorbell sound here, without a session: the long random token in the name
 * is the key. ?file is "<token>.mp3" or "<token>.wav".
 */
export default defineEventHandler(async (event) => {
  const file = String(getRouterParam(event, 'file') ?? '')
  const token = file.replace(/\.(mp3|wav)$/, '')
  const sound = await soundByToken(useDb(), token)
  if (!sound) throw createError({ statusCode: 404, statusMessage: 'Not found' })
  setResponseHeaders(event, { 'Content-Type': sound.mime, 'Content-Length': String(sound.audio.length), 'Cache-Control': 'private, max-age=3600' })
  return sound.audio
})
