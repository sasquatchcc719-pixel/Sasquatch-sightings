'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import {
  ChevronDown,
  ExternalLink,
  LogOut,
  Menu,
  Settings2,
  X,
} from 'lucide-react'
import { createClient } from '@/supabase/client'
import { ThemeSwitcher } from '@/components/theme-switcher'
import {
  NAVIGATION_ITEM_BY_ID,
  NAVIGATION_SECTIONS,
  isNavigationItemActive,
  type NavigationItem,
  type NavigationPreferences,
  type NavigationSectionId,
} from '@/lib/admin-navigation'
import { NavigationIcon } from '@/components/admin/navigation-icons'

function DrawerSection({
  sectionId,
  items,
  pathname,
  searchParams,
  onClose,
}: {
  sectionId: NavigationSectionId
  items: NavigationItem[]
  pathname: string
  searchParams: Pick<URLSearchParams, 'get'>
  onClose: () => void
}) {
  const [open, setOpen] = useState(false)
  const section = NAVIGATION_SECTIONS[sectionId]

  if (items.length === 0) return null

  return (
    <div className="border-b border-white/10 last:border-0">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between px-4 py-3 text-sm font-semibold text-slate-100"
      >
        <span className="flex items-center gap-2.5">
          <NavigationIcon
            name={section.icon}
            className="h-4 w-4 text-emerald-400"
          />
          {section.label}
        </span>
        <ChevronDown
          className={`h-3.5 w-3.5 text-slate-400 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <div className="pb-2">
          {items.map((item) => {
            const active = isNavigationItemActive(item, pathname, searchParams)
            const className = `flex items-center gap-3 border-l-2 px-5 py-2.5 transition-colors ${
              active
                ? 'border-l-emerald-400 bg-emerald-500/10 text-emerald-300'
                : 'border-l-transparent text-slate-300 hover:bg-white/5 hover:text-white'
            }`
            const content = (
              <>
                <NavigationIcon
                  name={item.icon}
                  className={`h-3.5 w-3.5 flex-shrink-0 ${active ? 'text-emerald-400' : 'text-slate-400'}`}
                />
                <span className="text-sm">{item.name}</span>
                {item.external && (
                  <ExternalLink className="ml-auto h-3 w-3 text-slate-500" />
                )}
              </>
            )

            return item.external ? (
              <a
                key={item.id}
                href={item.href}
                target="_blank"
                rel="noopener noreferrer"
                onClick={onClose}
                className={className}
              >
                {content}
              </a>
            ) : (
              <Link
                key={item.id}
                href={item.href}
                onClick={onClose}
                className={className}
              >
                {content}
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}

export function MobileHeader({
  userEmail,
  preferences,
  canEdit,
}: {
  userEmail: string
  preferences: NavigationPreferences
  canEdit: boolean
}) {
  const [drawerOpen, setDrawerOpen] = useState(false)
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const router = useRouter()
  const hidden = new Set(preferences.mobile.hidden)

  const handleLogout = async () => {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/auth/login')
  }

  const closeDrawer = () => setDrawerOpen(false)
  const username = userEmail?.split('@')[0] || 'Admin'

  return (
    <>
      <nav className="glass-nav fixed top-0 right-0 left-0 z-[200] flex h-14 items-center justify-between border-b px-4 sm:hidden">
        <Link
          href="/admin"
          onClick={closeDrawer}
          className="flex items-center gap-2"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/vector6-no-background.svg"
            alt="Sasquatch"
            className="h-8 w-auto"
          />
        </Link>

        <div className="flex items-center gap-3">
          <span className="max-w-[100px] truncate text-xs text-slate-300">
            {username}
          </span>
          <button
            type="button"
            onClick={() => void handleLogout()}
            className="flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5 text-xs text-slate-300 transition-colors hover:bg-white/20"
            aria-label="Log out"
          >
            <LogOut className="h-3.5 w-3.5" />
            <span>Log out</span>
          </button>
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            className="flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-slate-100 transition-colors hover:bg-white/20"
            aria-label="Open menu"
          >
            <Menu className="h-5 w-5" />
          </button>
        </div>
      </nav>

      {drawerOpen && (
        <div
          className="fixed inset-0 z-[290] bg-slate-950/70 sm:hidden"
          onClick={closeDrawer}
        />
      )}

      <div
        className={`fixed top-0 bottom-0 left-0 z-[300] w-[300px] overflow-y-auto transition-transform duration-300 ease-in-out sm:hidden ${
          drawerOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
        style={{
          background: 'rgba(15, 23, 42, 0.97)',
          backdropFilter: 'blur(16px)',
        }}
      >
        <div className="flex h-14 items-center justify-between border-b border-white/10 px-4">
          <div className="flex items-center gap-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/vector6-no-background.svg"
              alt="Sasquatch"
              className="h-7 w-auto"
            />
            <span className="text-sm font-semibold text-slate-100">Admin</span>
          </div>
          <button
            type="button"
            onClick={closeDrawer}
            className="flex h-8 w-8 items-center justify-center rounded-full text-slate-400 transition-colors hover:bg-white/10 hover:text-white"
            aria-label="Close menu"
          >
            <X className="h-4.5 w-4.5" />
          </button>
        </div>

        {canEdit && (
          <div className="border-b border-white/10 p-3">
            <Link
              href="/admin/navigation"
              onClick={closeDrawer}
              className="flex w-full items-center justify-center gap-2 rounded-lg border border-cyan-400/30 bg-cyan-400/10 px-3 py-2.5 text-sm font-semibold text-cyan-100"
            >
              <Settings2 className="h-4 w-4" />
              Edit navigation
            </Link>
          </div>
        )}

        <div className="py-2">
          {preferences.mobile.sectionOrder.map((sectionId) => {
            const items = preferences.mobile.sections[sectionId]
              .map((id) => NAVIGATION_ITEM_BY_ID[id])
              .filter((item): item is NavigationItem => Boolean(item))
              .filter((item) => !hidden.has(item.id))
            return (
              <DrawerSection
                key={sectionId}
                sectionId={sectionId}
                items={items}
                pathname={pathname}
                searchParams={searchParams}
                onClose={closeDrawer}
              />
            )
          })}
        </div>

        <div className="space-y-3 border-t border-white/10 p-4">
          <div className="flex items-center justify-between">
            <p className="truncate text-xs text-slate-500">{userEmail}</p>
            <div className="flex items-center rounded-full bg-white/5 px-1">
              <ThemeSwitcher />
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              void handleLogout()
              closeDrawer()
            }}
            className="flex w-full items-center gap-2 rounded-lg bg-white/5 px-3 py-2.5 text-sm text-slate-300 transition-colors hover:bg-white/10 hover:text-white"
          >
            <LogOut className="h-4 w-4" />
            Log out
          </button>
        </div>
      </div>
    </>
  )
}
