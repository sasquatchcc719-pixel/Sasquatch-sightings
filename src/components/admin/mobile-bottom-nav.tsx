'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Calendar, MessageSquare, Users } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'

type UnreadCountResponse = {
  total: number
  byChannel: { phone: number; lsa: number; yelp: number; other: number }
}

async function fetchUnreadCount(): Promise<UnreadCountResponse> {
  const res = await fetch('/api/admin/conversations/unread-count', {
    cache: 'no-store',
  })
  if (!res.ok)
    return { total: 0, byChannel: { phone: 0, lsa: 0, yelp: 0, other: 0 } }
  return res.json()
}

function BadgeCount({ count }: { count: number }) {
  if (count <= 0) return null
  const label = count > 9 ? '9+' : String(count)
  return (
    <span className="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] leading-none font-bold text-white shadow-md">
      {label}
    </span>
  )
}

const tabs = [
  {
    key: 'schedule',
    label: 'Schedule',
    href: '/admin/operations',
    icon: Calendar,
    match: (p: string) => p.startsWith('/admin/operations'),
  },
  {
    key: 'comms',
    label: 'Comms',
    href: '/admin/comms',
    icon: MessageSquare,
    match: (p: string) =>
      p.startsWith('/admin/comms') || p.startsWith('/admin/conversations'),
  },
  {
    key: 'customers',
    label: 'Customers',
    href: '/admin/operations/customers',
    icon: Users,
    match: (p: string) => p.startsWith('/admin/operations/customers'),
  },
]

export function MobileBottomNav() {
  const pathname = usePathname()

  const { data } = useQuery({
    queryKey: ['comms-unread'],
    queryFn: fetchUnreadCount,
    refetchInterval: 30_000,
    staleTime: 20_000,
  })

  const unreadTotal = data?.total ?? 0

  return (
    <nav
      className="fixed right-0 bottom-0 left-0 z-[200] border-t border-white/10 sm:hidden"
      style={{
        background: 'rgba(15, 23, 42, 0.92)',
        backdropFilter: 'blur(16px)',
      }}
    >
      {/* Safe area spacer for iOS home indicator */}
      <div className="flex items-stretch">
        {tabs.map((tab) => {
          const Icon = tab.icon
          const isActive = tab.match(pathname)

          return (
            <Link
              key={tab.key}
              href={tab.href}
              className={`relative flex flex-1 flex-col items-center justify-center gap-1 py-3 transition-colors ${
                isActive
                  ? 'text-emerald-400'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {/* Active indicator bar */}
              {isActive && (
                <span className="absolute top-0 right-6 left-6 h-0.5 rounded-full bg-gradient-to-r from-emerald-500 to-cyan-500" />
              )}

              <div className="relative">
                <Icon
                  className={`h-5 w-5 ${isActive ? 'text-emerald-400' : 'text-slate-400'}`}
                />
                {tab.key === 'comms' && <BadgeCount count={unreadTotal} />}
              </div>

              <span
                className={`text-[10px] leading-none font-medium ${
                  isActive ? 'text-emerald-400' : 'text-slate-500'
                }`}
              >
                {tab.label}
              </span>
            </Link>
          )
        })}
      </div>
      {/* iOS safe area padding */}
      <div
        className="h-safe-bottom bg-transparent"
        style={{ height: 'env(safe-area-inset-bottom)' }}
      />
    </nav>
  )
}
