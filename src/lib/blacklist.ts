import { createAdminClient } from '@/supabase/server'
import { sendOneSignalNotification } from '@/lib/onesignal'

export function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, '')
  return digits.length === 11 && digits.startsWith('1')
    ? digits.slice(1)
    : digits.slice(-10)
}

export async function isBlacklisted(phone: string): Promise<boolean> {
  try {
    const normalized = normalizePhone(phone)
    console.log(
      `[blacklist] Checking phone: ${phone} → normalized: ${normalized}`,
    )
    if (normalized.length < 10) return false
    const supabase = createAdminClient()
    const { data, error } = await supabase
      .from('blacklist')
      .select('id')
      .eq('phone', normalized)
      .maybeSingle()

    if (error) {
      console.error('[blacklist] DB query error:', error)
      // FAIL CLOSED - block call on DB errors to be safe
      return true
    }

    const isBlocked = data !== null
    console.log(
      `[blacklist] ${normalized} is ${isBlocked ? 'BLOCKED' : 'allowed'}`,
    )
    return isBlocked
  } catch (err) {
    console.error(
      '[blacklist] Unexpected error, BLOCKING call to be safe:',
      err,
    )
    // FAIL CLOSED - if something goes wrong, block the call
    return true
  }
}

export function notifyBlockedAttempt(phone: string, channel: string): void {
  const display = phone.replace(/^\+?1?(\d{3})(\d{3})(\d{4})$/, '($1) $2-$3')
  sendOneSignalNotification({
    heading: 'Blocked Attempt',
    content: `Blocked ${channel} from ${display || phone}`,
    data: { type: 'blacklist_block', phone, channel, url: '/admin/blacklist' },
  }).catch((err) => console.error('[blacklist] Push notification error:', err))
}
