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
    if (normalized.length < 10) return false
    const supabase = createAdminClient()
    const { data } = await supabase
      .from('blacklist')
      .select('id')
      .eq('phone', normalized)
      .maybeSingle()
    return data !== null
  } catch (err) {
    console.error('[blacklist] DB check failed, failing open:', err)
    return false
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
