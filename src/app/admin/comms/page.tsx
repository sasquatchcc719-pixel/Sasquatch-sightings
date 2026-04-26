import { createAdminClient } from '@/supabase/server'
import Link from 'next/link'
import { Inbox, MessageSquare, ChevronRight } from 'lucide-react'
import { countUnreadInboundMessages } from '@/lib/conversations-unread'

type ConversationRow = {
  source: string | null
  messages: { role: string; timestamp?: string }[]
  admin_read_at: string | null
  updated_at: string
}

function getLastActiveLabel(updatedAt: string): string {
  const d = new Date(updatedAt)
  const now = new Date()
  const diffMs = now.getTime() - d.getTime()
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))
  if (diffDays === 0) return 'Today'
  if (diffDays === 1) return 'Yesterday'
  return d.toLocaleDateString('en-US', {
    month: '2-digit',
    day: '2-digit',
    year: '2-digit',
  })
}

export default async function CommsHubPage() {
  const supabase = createAdminClient()

  const { data: conversations } = await supabase
    .from('conversations')
    .select('source, messages, admin_read_at, updated_at')
    .order('updated_at', { ascending: false })

  const rows = (conversations || []) as ConversationRow[]

  // Per-channel stats
  type ChannelStats = { unread: number; lastActive: string | null }
  const channels: Record<string, ChannelStats> = {
    phone: { unread: 0, lastActive: null },
    lsa: { unread: 0, lastActive: null },
    yelp: { unread: 0, lastActive: null },
    // NFC, contest, business card, missing source, etc. — still count for the global badge
    other: { unread: 0, lastActive: null },
  }

  for (const conv of rows) {
    const src = (conv.source || '').toLowerCase()
    let key: string | null = null
    if (src === 'inbound') key = 'phone'
    else if (src === 'google lsa' || src === 'lsa') key = 'lsa'
    else if (src === 'yelp') key = 'yelp'

    if (key) {
      channels[key].unread += countUnreadInboundMessages(conv)
      if (!channels[key].lastActive) {
        channels[key].lastActive = conv.updated_at
      }
    } else {
      channels.other.unread += countUnreadInboundMessages(conv)
      if (!channels.other.lastActive) {
        channels.other.lastActive = conv.updated_at
      }
    }
  }

  const channelConfig = [
    {
      key: 'phone',
      label: 'Direct Texts',
      description: 'Customers who texted your number directly',
      href: '/admin/conversations?source=phone',
      icon: (
        <div className="flex h-11 w-11 items-center justify-center rounded-full bg-blue-500/20 text-blue-400">
          <MessageSquare className="h-5 w-5" />
        </div>
      ),
      active: true,
    },
    {
      key: 'lsa',
      label: 'Google LSA',
      description: 'Local Services Ads inbound leads',
      href: '/admin/conversations?source=lsa',
      icon: (
        <div className="flex h-11 w-11 items-center justify-center rounded-full bg-white/10">
          <span className="text-lg font-bold">
            <span className="text-blue-400">G</span>
            <span className="text-red-400">o</span>
            <span className="text-yellow-400">o</span>
            <span className="text-blue-400">g</span>
            <span className="text-green-400">l</span>
            <span className="text-red-400">e</span>
          </span>
        </div>
      ),
      active: true,
    },
    {
      key: 'yelp',
      label: 'Yelp',
      description: 'Coming soon — integration not yet active',
      href: '/admin/conversations?source=yelp',
      icon: (
        <div className="flex h-11 w-11 items-center justify-center rounded-full bg-red-500/15">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/yelp-logo.svg" alt="Yelp" className="h-6 w-6 opacity-50" />
        </div>
      ),
      active: false,
    },
    {
      key: 'other',
      label: 'Other',
      description:
        'NFC, contest, business card, missing source — not in Direct/LSA/Yelp',
      href: '/admin/conversations',
      icon: (
        <div className="flex h-11 w-11 items-center justify-center rounded-full bg-amber-500/15 text-amber-400">
          <Inbox className="h-5 w-5" />
        </div>
      ),
      active: true,
    },
  ]

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Comms</h1>
        <p className="text-muted-foreground text-sm">
          Inbound messages by channel
        </p>
      </div>

      <div className="overflow-hidden rounded-2xl border border-white/10">
        {channelConfig.map((ch, i) => {
          const stats = channels[ch.key]
          const isLast = i === channelConfig.length - 1

          return (
            <Link
              key={ch.key}
              href={ch.active ? ch.href : '#'}
              className={`flex items-center gap-3 px-4 py-3.5 transition-colors ${
                ch.active
                  ? 'hover:bg-white/5 active:bg-white/10'
                  : 'cursor-default opacity-50'
              } ${!isLast ? 'border-b border-white/10' : ''}`}
            >
              {ch.icon}

              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span
                    className={`text-sm font-semibold ${ch.active ? 'text-foreground' : 'text-muted-foreground'}`}
                  >
                    {ch.label}
                  </span>
                  {!ch.active && (
                    <span className="text-muted-foreground rounded-full bg-white/10 px-1.5 py-0.5 text-[10px]">
                      Coming Soon
                    </span>
                  )}
                </div>
                <p className="text-muted-foreground truncate text-xs">
                  {stats.lastActive
                    ? `Last active ${getLastActiveLabel(stats.lastActive)}`
                    : ch.description}
                </p>
              </div>

              <div className="flex items-center gap-2">
                {stats.unread > 0 && (
                  <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1.5 text-[11px] font-bold text-white">
                    {stats.unread > 99 ? '99+' : stats.unread}
                  </span>
                )}
                {ch.active && (
                  <ChevronRight className="text-muted-foreground h-4 w-4 flex-shrink-0" />
                )}
              </div>
            </Link>
          )
        })}
      </div>
    </div>
  )
}
