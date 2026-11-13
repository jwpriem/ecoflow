/**
 * Initials for the account button, from the e-mail address (accounts have no name): the first letter of the
 * first and the last part of the local part, so j.w.priem@… gives JP and anna-de-vries@… AV. A local part
 * without separators gives its first letter.
 */
export function initials(email: string | null | undefined): string {
  const local = (email ?? '').split('@')[0] ?? ''
  const parts = local.split(/[._+\-]+/).filter((p) => /\p{L}/u.test(p))
  const letter = (p: string | undefined) => p?.match(/\p{L}/u)?.[0] ?? ''
  const out = parts.length > 1 ? letter(parts[0]) + letter(parts[parts.length - 1]) : letter(parts[0])
  return out.toLocaleUpperCase() || '?'
}
