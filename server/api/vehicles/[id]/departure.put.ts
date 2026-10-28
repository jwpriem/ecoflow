import { assertExperimental } from '../../../services/experimental'
import { isDepartureTime, setTibberDeparture, WEEKDAYS, type Weekday } from '../../../services/tibberEv'

/**
 * Set when the car has to leave: the given weekday gets the time in Tibber, every other day
 * "No specific departure time". Body: { day: 'monday'..'sunday', time: 'HH:MM' }.
 */
export default defineEventHandler(async (event) => {
  const { site, experimental } = await requireSite(event)
  assertExperimental(experimental)
  const id = Number(getRouterParam(event, 'id'))
  const b = await readBody<{ day?: string; time?: string }>(event)
  if (!WEEKDAYS.includes(b.day as Weekday)) throw createError({ statusCode: 400, statusMessage: 'Bad day' })
  if (!isDepartureTime(b.time)) throw createError({ statusCode: 400, statusMessage: 'Bad time' })
  const time = b.time.padStart(5, '0')
  try {
    return { days: await setTibberDeparture(useDb(), site, encryptionKey(), id, b.day as Weekday, time) }
  } catch (err) {
    throw createError({ statusCode: 502, statusMessage: (err as Error).message.slice(0, 200) })
  }
})
