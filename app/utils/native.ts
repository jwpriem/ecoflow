import { Capacitor } from '@capacitor/core'

/** True inside the iOS app; false on the web, where nothing below is loaded */
export const isNative = () => Capacitor.isNativePlatform()

const TOKEN_KEY = 'battery.token'

// The Keychain item is readable after the first unlock (so a push can wake the app) and never leaves this device:
// not to iCloud Keychain, not into a backup restored on another phone
async function keychain() {
  const { SecureStorage, KeychainAccess } = await import('@aparajita/capacitor-secure-storage')
  await SecureStorage.setSynchronize(false)
  await SecureStorage.setDefaultKeychainAccess(KeychainAccess.afterFirstUnlockThisDeviceOnly)
  return SecureStorage
}

export async function readNativeToken(): Promise<string | null> {
  try {
    return await (await keychain()).getItem(TOKEN_KEY)
  } catch {
    return null
  }
}

export async function writeNativeToken(value: string | null) {
  try {
    const store = await keychain()
    if (value) await store.setItem(TOKEN_KEY, value)
    else await store.removeItem(TOKEN_KEY)
  } catch (err) {
    console.warn('[native] keychain', (err as Error).message)
  }
}
