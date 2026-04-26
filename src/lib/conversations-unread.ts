/**
 * Unread = inbound (role user) messages with timestamp after admin_read_at.
 * Aligned with Comms hub, conversation list, and /api/admin/conversations/unread-count.
 *
 * Notes:
 * - After a thread is read, user messages *without* a stored timestamp are not
 *   treated as unread (avoids a stuck badge from legacy rows).
 * - Inbound role is compared case-insensitively.
 */
export type ConversationForUnread = {
  messages: Array<{ role: string; timestamp?: string }>
  admin_read_at: string | null
}

function isInboundUserMessage(m: { role: string }): boolean {
  return String(m.role).toLowerCase() === 'user'
}

/**
 * Set when admin opens a thread so read_at is not earlier than the latest
 * customer message (avoids clock / ordering glitches).
 */
export function computeReadWatermarkIso(
  messages: Array<{ role: string; timestamp?: string }>,
): string {
  let maxMs = Date.now()
  for (const m of messages) {
    if (!isInboundUserMessage(m) || !m.timestamp) continue
    const t = new Date(m.timestamp).getTime()
    if (!Number.isNaN(t) && t > maxMs) maxMs = t
  }
  return new Date(maxMs).toISOString()
}

export function countUnreadInboundMessages(
  conv: ConversationForUnread,
): number {
  if (!conv.messages?.length) return 0
  const readAtRaw = conv.admin_read_at ? new Date(conv.admin_read_at) : null
  const readMs =
    readAtRaw && !Number.isNaN(readAtRaw.getTime()) ? readAtRaw.getTime() : null
  return conv.messages.filter((m) => {
    if (!isInboundUserMessage(m)) return false
    if (readMs == null) return true
    if (!m.timestamp) return false
    const t = new Date(m.timestamp).getTime()
    if (Number.isNaN(t)) return false
    return t > readMs
  }).length
}

export function sourceToCommsChannel(
  source: string | null,
): 'phone' | 'lsa' | 'yelp' | 'other' {
  if (!source) return 'other'
  const s = source.toLowerCase()
  if (s === 'inbound') return 'phone'
  if (s === 'google lsa' || s === 'lsa') return 'lsa'
  if (s === 'yelp') return 'yelp'
  return 'other'
}
