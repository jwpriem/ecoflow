import { and, eq, sql } from 'drizzle-orm'
import webpush from 'web-push'
import type { Db } from '../db/client'
import { appConfig, pushSubscriptions, sites, users, type PushTopic } from '../db/schema'
import { decryptJson, encryptJson } from '../utils/crypto'

export const PUSH_TOPICS: PushTopic[] = ['plan', 'prices', 'errors', 'daily']

export interface PushMessage {
  title: string
  body: string
  /** Page to open when the notification is tapped */
  url?: string
  /** Notifications with the same tag replace each other instead of stacking */
  tag?: string
}

type Vapid = { publicKey: string; privateKey: string }
let vapid: Promise<Vapid> | undefined

/**
 * The VAPID key pair identifies this server to Apple/Google/Mozilla push services.
 * Taken from NUXT_VAPID_PUBLIC_KEY / NUXT_VAPID_PRIVATE_KEY when set, otherwise generated once and
 * kept in the database (private key encrypted), so it survives redeploys. Changing it invalidates
 * every subscription.
 */
export function vapidKeys(db: Db): Promise<Vapid> {
  const pub = process.env.NUXT_VAPID_PUBLIC_KEY
  const priv = process.env.NUXT_VAPID_PRIVATE_KEY
  if (pub && priv) return Promise.resolve({ publicKey: pub, privateKey: priv })
  vapid ??= (async () => {
    const encKey = useRuntimeConfig().encryptionKey || process.env.NUXT_ENCRYPTION_KEY || ''
    const generated = webpush.generateVAPIDKeys()
    await db.insert(appConfig).values({ key: 'vapid', value: encryptJson(generated, encKey) }).onConflictDoNothing()
    const [row] = await db.select().from(appConfig).where(eq(appConfig.key, 'vapid'))
    return decryptJson<Vapid>(row!.value, encKey)
  })().catch((err) => {
    vapid = undefined
    throw err
  })
  return vapid
}

/** Apple rejects pushes without a real contact: NUXT_VAPID_SUBJECT, else the site owner's email. */
async function vapidSubject(db: Db, siteId: number): Promise<string> {
  if (process.env.NUXT_VAPID_SUBJECT) return process.env.NUXT_VAPID_SUBJECT
  const [row] = await db.select({ email: users.email }).from(sites).innerJoin(users, eq(users.id, sites.userId)).where(eq(sites.id, siteId))
  return `mailto:${row?.email ?? 'admin@example.com'}`
}

/**
 * Send a notification to every device of a site that subscribed to the topic.
 * Never throws: a failing notification must not break the job that triggered it.
 * Subscriptions the push service reports as gone (404/410) are removed.
 */
export async function notify(db: Db, siteId: number, topic: PushTopic | null, msg: PushMessage, only?: string) {
  try {
    const subs = await db
      .select()
      .from(pushSubscriptions)
      .where(
        and(
          eq(pushSubscriptions.siteId, siteId),
          only ? eq(pushSubscriptions.endpoint, only) : undefined,
          topic ? sql`${pushSubscriptions.topics} ? ${topic}` : undefined,
        ),
      )
    if (!subs.length) return { sent: 0, failed: 0, error: 'No subscription for this device' }
    const keys = await vapidKeys(db)
    const subject = await vapidSubject(db, siteId)
    const payload = JSON.stringify({ ...msg, url: msg.url ?? '/' })
    let sent = 0
    let failed = 0
    let error: string | undefined
    for (const s of subs) {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, {
          vapidDetails: { subject, publicKey: keys.publicKey, privateKey: keys.privateKey },
          TTL: 6 * 3600,
          urgency: topic === 'errors' ? 'high' : 'normal',
          ...(msg.tag ? { topic: msg.tag.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32) } : {}),
        })
        await db.update(pushSubscriptions).set({ lastOkAt: new Date() }).where(eq(pushSubscriptions.id, s.id))
        sent++
      } catch (err) {
        failed++
        const status = (err as { statusCode?: number }).statusCode
        error = `${status ?? ''} ${(err as { body?: string }).body || (err as Error).message}`.trim()
        if (status === 404 || status === 410) {
          error = "This device's subscription has expired, turn notifications on again"
          await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, s.id))
        } else console.error(`[push] site ${siteId}: ${error}`)
      }
    }
    return { sent, failed, error }
  } catch (err) {
    console.error(`[push] site ${siteId}:`, (err as Error).message)
    return { sent: 0, failed: 0, error: (err as Error).message }
  }
}
