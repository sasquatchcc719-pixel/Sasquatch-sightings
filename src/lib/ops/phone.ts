/** E.164 for US numbers; aligns with admin booking and Twilio-style storage. */
export function normalizeOpsPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '')
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`
  return phone.startsWith('+') ? phone : `+${digits}`
}

/**
 * Values that might appear in `ops_customers.phone` from older imports or manual entry.
 * Used for find-or-create so we don't insert a second row for the same handset.
 */
export function opsPhoneLookupVariants(raw: string): string[] {
  const trimmed = String(raw || '').trim()
  if (!trimmed) return []

  const digits = trimmed.replace(/\D/g, '')
  const last10 = digits.length >= 10 ? digits.slice(-10) : null

  const set = new Set<string>()
  set.add(trimmed)
  if (digits) set.add(digits)
  if (last10) {
    set.add(last10)
    set.add(`+1${last10}`)
    set.add(`1${last10}`)
    set.add(`(${last10.slice(0, 3)}) ${last10.slice(3, 6)}-${last10.slice(6)}`)
  }
  set.add(normalizeOpsPhone(trimmed))
  return [...set].filter(Boolean)
}
