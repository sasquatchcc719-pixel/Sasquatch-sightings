/**
 * Unread = inbound (role user) messages with timestamp after admin_read_at.
 * Aligned with Comms hub, conversation list, and /api/admin/conversations/unread-count.
 */
export type ConversationForUnread = {
  messages: Array<{ role: string; timestamp?: string }>
  admin_read_at: string | null
}

export function countUnreadInboundMessages(
  conv: ConversationForUnread,
): number {
  if (!conv.messages?.length) return 0
  const readAt = conv.admin_read_at ? new Date(conv.admin_read_at) : null
  return conv.messages.filter((m) => {
    if (m.role !== 'user') return false
    if (!readAt) return true
    if (!m.timestamp) return true
    return new Date(m.timestamp) > readAt
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
