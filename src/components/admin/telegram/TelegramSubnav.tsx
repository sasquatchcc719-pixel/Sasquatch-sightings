'use client'

import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { TELEGRAM_CHANNELS } from '@/lib/telegram-channels'

export function TelegramSubnav() {
  const pathname = usePathname()
  const params = useSearchParams()
  const view = params.get('view')

  return (
    <nav className="-mx-1 mb-6 overflow-x-auto px-1 pb-1">
      <ul className="flex min-w-max gap-1.5">
        {TELEGRAM_CHANNELS.map((channel) => {
          const isRankings = channel.href === '/admin/telegram'
          const viewId = new URL(
            channel.href,
            'https://sightings.sasquatchcarpet.com',
          ).searchParams.get('view')
          const active = isRankings
            ? pathname === '/admin/telegram' && !view
            : pathname === '/admin/telegram' && view === viewId
          return (
            <li key={channel.href}>
              <Link
                href={channel.href}
                scroll={isRankings}
                className={`block rounded-full border px-3.5 py-1.5 transition-colors ${
                  active
                    ? 'border-amber-400/50 bg-amber-400 text-stone-950'
                    : 'border-white/10 bg-black/30 text-white/70 hover:border-white/25 hover:text-white'
                }`}
              >
                <span className="block text-[13px] font-semibold tracking-tight">
                  {channel.name}
                </span>
                <span
                  className={`block text-[10px] tracking-wide uppercase ${
                    active ? 'text-stone-800/70' : 'text-white/40'
                  }`}
                >
                  {channel.when}
                </span>
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
