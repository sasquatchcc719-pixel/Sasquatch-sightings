'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  Calendar,
  MessageSquare,
  Users,
  BarChart3,
  LogIn,
  LogOut,
  Clock,
} from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useGpsContextOptional } from '@/contexts/GpsTrackerContext'
import { GpsConsentModal } from '@/components/admin/GpsConsentModal'

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
  // Match per-message counts (can exceed 9); cap display at 99+ for layout
  const label = count > 99 ? '99+' : String(count)
  return (
    <span
      className={`absolute -top-1 -right-1 flex min-h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] leading-none font-bold text-white shadow-md ${
        count > 9 ? 'min-w-5 px-1.5' : ''
      }`}
    >
      {label}
    </span>
  )
}

function formatElapsed(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000)
  const h = Math.floor(totalSeconds / 3600)
  const m = Math.floor((totalSeconds % 3600) / 60)
  const s = totalSeconds % 60
  if (h > 0)
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${m}:${String(s).padStart(2, '0')}`
}

const NAV_TABS = [
  {
    key: 'schedule',
    label: 'Schedule',
    href: '/admin/operations',
    icon: Calendar,
    match: (p: string) =>
      p.startsWith('/admin/operations') &&
      !p.startsWith('/admin/operations/customers'),
  },
  {
    key: 'comms',
    label: 'Comms',
    href: '/admin/comms',
    icon: MessageSquare,
    match: (p: string) =>
      p.startsWith('/admin/comms') || p.startsWith('/admin/conversations'),
  },
  // GPS tab injected here when enabled
  {
    key: 'customers',
    label: 'Customers',
    href: '/admin/operations/customers',
    icon: Users,
    match: (p: string) => p.startsWith('/admin/operations/customers'),
  },
  {
    key: 'stats',
    label: 'Stats',
    href: '/admin/stats',
    icon: BarChart3,
    match: (p: string) => p.startsWith('/admin/stats'),
  },
]

function GpsNavTab() {
  const gps = useGpsContextOptional()
  const [showConsent, setShowConsent] = useState(false)
  const [confirmOut, setConfirmOut] = useState(false)
  const [loading, setLoading] = useState(false)

  if (!gps || !gps.gpsEnabled) return null

  const {
    isClocked,
    elapsedMs,
    segmentType,
    clockIn,
    clockOut,
    consentGiven,
    grantConsent,
  } = gps

  async function handleTap() {
    if (!isClocked) {
      if (!consentGiven) {
        setShowConsent(true)
        return
      }
      setLoading(true)
      await clockIn()
      setLoading(false)
    } else {
      if (!confirmOut) {
        setConfirmOut(true)
        // Auto-reset the confirm state after 3s if not tapped again
        setTimeout(() => setConfirmOut(false), 3000)
        return
      }
      setLoading(true)
      await clockOut()
      setLoading(false)
      setConfirmOut(false)
    }
  }

  async function handleConsentAccept() {
    grantConsent()
    setShowConsent(false)
    setLoading(true)
    await clockIn()
    setLoading(false)
  }

  const isOnSite = segmentType === 'on_site'
  const isTraveling = segmentType === 'traveling'

  return (
    <>
      {showConsent && (
        <GpsConsentModal
          onAccept={handleConsentAccept}
          onDismiss={() => setShowConsent(false)}
        />
      )}

      <button
        onClick={handleTap}
        disabled={loading}
        className="relative flex flex-1 flex-col items-center justify-center gap-1 py-3 transition-colors disabled:opacity-50"
      >
        {/* Active indicator bar */}
        {isClocked && (
          <span className="absolute top-0 right-6 left-6 h-0.5 rounded-full bg-gradient-to-r from-emerald-500 to-cyan-500" />
        )}

        {/* Icon area */}
        <div className="relative flex h-5 w-5 items-center justify-center">
          {isClocked && (
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-30" />
          )}
          {loading ? (
            <Clock className="h-5 w-5 animate-pulse text-slate-400" />
          ) : confirmOut ? (
            <LogOut className="h-5 w-5 text-red-400" />
          ) : isClocked ? (
            <Clock
              className={`h-5 w-5 ${
                isOnSite
                  ? 'text-emerald-400'
                  : isTraveling
                    ? 'text-blue-400'
                    : 'text-emerald-400'
              }`}
            />
          ) : (
            <LogIn className="h-5 w-5 text-emerald-400" />
          )}
        </div>

        {/* Label / elapsed */}
        {isClocked ? (
          <span
            className={`font-mono text-[10px] leading-none font-semibold tabular-nums ${
              confirmOut
                ? 'text-red-400'
                : isOnSite
                  ? 'text-emerald-400'
                  : isTraveling
                    ? 'text-blue-400'
                    : 'text-emerald-400'
            }`}
          >
            {confirmOut ? 'Tap again' : formatElapsed(elapsedMs)}
          </span>
        ) : (
          <span className="text-[10px] leading-none font-medium text-emerald-500">
            {loading ? '…' : 'Clock In'}
          </span>
        )}
      </button>
    </>
  )
}

export function MobileBottomNav() {
  const pathname = usePathname()
  const gps = useGpsContextOptional()
  const gpsEnabled = gps?.gpsEnabled ?? false

  const { data } = useQuery({
    queryKey: ['comms-unread'],
    queryFn: fetchUnreadCount,
    refetchInterval: 5_000, // Check every 5 seconds instead of 30
    staleTime: 0, // Always refetch on focus/mount
    refetchOnWindowFocus: true, // Refresh when switching back to the tab
  })

  const unreadTotal = data?.total ?? 0

  // Split tabs: first 2, GPS in center, last 2
  const leftTabs = NAV_TABS.slice(0, 2)
  const rightTabs = NAV_TABS.slice(2)

  return (
    <nav
      className="fixed right-0 bottom-0 left-0 z-[200] border-t border-white/10 sm:hidden"
      style={{
        background: 'rgba(15, 23, 42, 0.92)',
        backdropFilter: 'blur(16px)',
      }}
    >
      <div className="flex items-stretch">
        {/* Left tabs */}
        {leftTabs.map((tab) => {
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
                className={`text-[10px] leading-none font-medium ${isActive ? 'text-emerald-400' : 'text-slate-500'}`}
              >
                {tab.label}
              </span>
            </Link>
          )
        })}

        {/* Center GPS tab — only when enabled */}
        {gpsEnabled && <GpsNavTab />}

        {/* Right tabs */}
        {rightTabs.map((tab) => {
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
              {isActive && (
                <span className="absolute top-0 right-6 left-6 h-0.5 rounded-full bg-gradient-to-r from-emerald-500 to-cyan-500" />
              )}
              <div className="relative">
                <Icon
                  className={`h-5 w-5 ${isActive ? 'text-emerald-400' : 'text-slate-400'}`}
                />
              </div>
              <span
                className={`text-[10px] leading-none font-medium ${isActive ? 'text-emerald-400' : 'text-slate-500'}`}
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
