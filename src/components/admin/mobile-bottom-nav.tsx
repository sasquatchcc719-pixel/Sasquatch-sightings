'use client'

import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { LogIn, LogOut, Clock } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useGpsContextOptional } from '@/contexts/GpsTrackerContext'
import { GpsConsentModal } from '@/components/admin/GpsConsentModal'
import {
  NAVIGATION_ITEM_BY_ID,
  isNavigationItemActive,
  type NavigationItem,
  type NavigationPreferences,
} from '@/lib/admin-navigation'
import { NavigationIcon } from '@/components/admin/navigation-icons'

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

function BottomTab({
  item,
  active,
  unreadTotal,
}: {
  item: NavigationItem
  active: boolean
  unreadTotal: number
}) {
  const showsUnread = [
    'comms-home',
    'all-conversations',
    'direct-texts',
  ].includes(item.id)
  return (
    <Link
      href={item.href}
      className={`relative flex flex-1 flex-col items-center justify-center gap-1 py-3 transition-colors ${
        active ? 'text-emerald-400' : 'text-slate-400 hover:text-slate-200'
      }`}
    >
      {active && (
        <span className="absolute top-0 right-6 left-6 h-0.5 rounded-full bg-gradient-to-r from-emerald-500 to-cyan-500" />
      )}
      <div className="relative">
        <NavigationIcon
          name={item.icon}
          className={`h-5 w-5 ${active ? 'text-emerald-400' : 'text-slate-400'}`}
        />
        {showsUnread && <BadgeCount count={unreadTotal} />}
      </div>
      <span
        className={`max-w-[70px] truncate text-[10px] leading-none font-medium ${active ? 'text-emerald-400' : 'text-slate-500'}`}
      >
        {item.shortName ?? item.name}
      </span>
    </Link>
  )
}

export function MobileBottomNav({
  preferences,
}: {
  preferences: NavigationPreferences
}) {
  const pathname = usePathname()
  const searchParams = useSearchParams()
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

  const tabs = preferences.mobile.bottom
    .map((id) => NAVIGATION_ITEM_BY_ID[id])
    .filter((item): item is NavigationItem => Boolean(item))
  const leftTabs = tabs.slice(0, 2)
  const rightTabs = tabs.slice(2)

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
        {leftTabs.map((item) => (
          <BottomTab
            key={item.id}
            item={item}
            active={isNavigationItemActive(item, pathname, searchParams)}
            unreadTotal={unreadTotal}
          />
        ))}

        {/* Center GPS tab — only when enabled */}
        {gpsEnabled && <GpsNavTab />}

        {/* Right tabs */}
        {rightTabs.map((item) => (
          <BottomTab
            key={item.id}
            item={item}
            active={isNavigationItemActive(item, pathname, searchParams)}
            unreadTotal={unreadTotal}
          />
        ))}
      </div>

      {/* iOS safe area padding */}
      <div
        className="h-safe-bottom bg-transparent"
        style={{ height: 'env(safe-area-inset-bottom)' }}
      />
    </nav>
  )
}
