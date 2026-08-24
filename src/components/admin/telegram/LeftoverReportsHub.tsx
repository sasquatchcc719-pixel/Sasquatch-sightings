'use client'

import type { ReactNode } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { RadarDailyDash } from '@/components/admin/telegram/RadarDailyDash'
import { ReviewsDash } from '@/components/admin/telegram/ReviewsDash'
import { CoverageDash } from '@/components/admin/telegram/CoverageDash'
import { TruckDash } from '@/components/admin/telegram/TruckDash'
import TelegramBriefingPage from '@/app/admin/telegram/briefing/page'
import TelegramGridPage from '@/app/admin/telegram/grid/page'
import TelegramOpportunitiesPage from '@/app/admin/telegram/opportunities/page'
import TelegramAlertsPage from '@/app/admin/telegram/alerts/page'
import { LEFTOVER_CHANNELS } from '@/lib/telegram-channels'

const VIEWS: Record<string, () => ReactNode> = {
  radar: () => <RadarDailyDash />,
  reviews: () => <ReviewsDash />,
  coverage: () => <CoverageDash mode="watch" />,
  briefing: () => <TelegramBriefingPage />,
  grid: () => <TelegramGridPage />,
  sweep: () => <CoverageDash mode="sweep" />,
  opportunities: () => <TelegramOpportunitiesPage />,
  truck: () => <TruckDash />,
  alerts: () => <TelegramAlertsPage />,
}

export function LeftoverReportsHub() {
  const params = useSearchParams()
  const view = params.get('view') || 'radar'
  const render = VIEWS[view] ?? VIEWS.radar

  return (
    <section id="leftover-reports" className="scroll-mt-24 space-y-5">
      <div>
        <p className="text-[11px] font-semibold tracking-[0.28em] text-amber-300/90 uppercase">
          The rest of Telegram
        </p>
        <h2
          className="mt-1 text-4xl text-white"
          style={{ fontFamily: 'var(--font-telegram-display), Georgia, serif' }}
        >
          Leftover messages, with the numbers
        </h2>
        <p className="text-muted-foreground mt-2 max-w-2xl text-sm leading-6">
          Rankings above is the Monday push. Everything you still get on
          Telegram is here — pick a message, see the dashboard, change what it
          tracks.
        </p>
      </div>

      <div className="-mx-1 overflow-x-auto px-1 pb-1">
        <ul className="flex min-w-max gap-1.5">
          {LEFTOVER_CHANNELS.map((channel) => {
            const active = view === channel.id
            return (
              <li key={channel.id}>
                <Link
                  href={`/admin/telegram?view=${channel.id}#leftover-reports`}
                  scroll={false}
                  className={`block rounded-full border px-3.5 py-1.5 ${
                    active
                      ? 'border-amber-400/50 bg-amber-400 text-stone-950'
                      : 'border-white/10 bg-black/30 text-white/70 hover:border-white/25 hover:text-white'
                  }`}
                >
                  <span className="block text-[13px] font-semibold">
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
      </div>

      {render()}
    </section>
  )
}
