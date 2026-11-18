'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { ChevronDown, ExternalLink, Settings2 } from 'lucide-react'
import {
  NAVIGATION_ITEM_BY_ID,
  NAVIGATION_SECTIONS,
  isNavigationItemActive,
  type NavigationItem,
  type NavigationPreferences,
  type NavigationSectionId,
} from '@/lib/admin-navigation'
import { NavigationIcon } from '@/components/admin/navigation-icons'

function ItemLink({
  item,
  active,
  onClose,
}: {
  item: NavigationItem
  active: boolean
  onClose: () => void
}) {
  const className = `flex items-start gap-3 rounded-lg border-l-2 px-3 py-2 transition-all ${
    active
      ? 'border-l-emerald-400 bg-emerald-500/10 text-emerald-300'
      : 'text-foreground/80 hover:bg-accent hover:text-accent-foreground border-l-transparent hover:border-l-emerald-400/50'
  }`
  const content = (
    <>
      <NavigationIcon
        name={item.icon}
        className={`mt-0.5 h-4 w-4 flex-shrink-0 ${active ? 'text-emerald-400' : ''}`}
      />
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium">
          {item.desktopName ?? item.name}
        </div>
        <div className="text-muted-foreground text-xs">{item.description}</div>
      </div>
      {item.external && <ExternalLink className="mt-1 h-3 w-3 flex-shrink-0" />}
    </>
  )

  return item.external ? (
    <a
      href={item.href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={onClose}
      className={className}
    >
      {content}
    </a>
  ) : (
    <Link href={item.href} onClick={onClose} className={className}>
      {content}
    </Link>
  )
}

function NavDropdown({
  sectionId,
  isOpen,
  onToggle,
  onClose,
  items,
  pathname,
  searchParams,
}: {
  sectionId: NavigationSectionId
  isOpen: boolean
  onToggle: () => void
  onClose: () => void
  items: NavigationItem[]
  pathname: string
  searchParams: Pick<URLSearchParams, 'get'>
}) {
  const section = NAVIGATION_SECTIONS[sectionId]
  const active = items.some((item) =>
    isNavigationItemActive(item, pathname, searchParams),
  )

  if (items.length === 0) return null

  return (
    <div className="relative">
      <button
        type="button"
        onClick={onToggle}
        className={`flex w-full items-center justify-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition-all sm:w-auto sm:justify-start ${
          active
            ? 'bg-gradient-to-r from-emerald-500 to-cyan-500 text-slate-950 shadow-[0_0_20px_rgba(16,185,129,0.35)]'
            : 'bg-white/10 text-slate-100 hover:bg-white/20 hover:text-white'
        }`}
      >
        <NavigationIcon name={section.icon} className="h-4 w-4" />
        {section.label}
        <ChevronDown
          className={`h-3 w-3 transition-transform ${isOpen ? 'rotate-180' : ''}`}
        />
      </button>

      {isOpen && (
        <>
          <div className="fixed inset-0 z-[100]" onClick={onClose} />
          <div className="animate-dropdown-in border-border bg-popover text-popover-foreground absolute top-full left-0 z-[110] mt-2 max-h-[70vh] w-72 overflow-y-auto rounded-xl border shadow-2xl">
            <div className="space-y-0.5 p-2">
              {items.map((item) => (
                <ItemLink
                  key={item.id}
                  item={item}
                  active={isNavigationItemActive(item, pathname, searchParams)}
                  onClose={onClose}
                />
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

export function AdminNavigation({
  preferences,
  canEdit,
}: {
  preferences: NavigationPreferences
  canEdit: boolean
}) {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [openSection, setOpenSection] = useState<NavigationSectionId | null>(
    null,
  )
  const hidden = new Set(preferences.desktop.hidden)
  const shortcutLinks = preferences.desktop.shortcuts.map((id) => {
    const item = NAVIGATION_ITEM_BY_ID[id]
    if (!item) return null
    const active = isNavigationItemActive(item, pathname, searchParams)
    return (
      <Link
        key={item.id}
        href={item.href}
        className={`flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition-all ${
          active
            ? 'bg-gradient-to-r from-emerald-500 to-cyan-500 text-slate-950 shadow-[0_0_20px_rgba(16,185,129,0.35)]'
            : 'bg-white/10 text-slate-100 hover:bg-white/20 hover:text-white'
        }`}
      >
        <NavigationIcon name={item.icon} className="h-4 w-4" />
        {item.shortName ?? item.desktopName ?? item.name}
      </Link>
    )
  })

  return (
    <nav aria-label="Admin navigation">
      <div className="flex flex-wrap items-center gap-3">
        {preferences.desktop.shortcutAfter === 'start' && shortcutLinks}
        {preferences.desktop.sectionOrder.map((sectionId) => {
          const items = preferences.desktop.sections[sectionId]
            .map((id) => NAVIGATION_ITEM_BY_ID[id])
            .filter((item): item is NavigationItem => Boolean(item))
            .filter((item) => !hidden.has(item.id))
          return (
            <div key={sectionId} className="contents">
              <NavDropdown
                sectionId={sectionId}
                isOpen={openSection === sectionId}
                onToggle={() =>
                  setOpenSection((current) =>
                    current === sectionId ? null : sectionId,
                  )
                }
                onClose={() => setOpenSection(null)}
                items={items}
                pathname={pathname}
                searchParams={searchParams}
              />
              {preferences.desktop.shortcutAfter === sectionId && shortcutLinks}
            </div>
          )
        })}
        {preferences.desktop.shortcutAfter === 'end' && shortcutLinks}

        {canEdit && (
          <Link
            href="/admin/navigation"
            className={`ml-auto flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium transition-colors ${
              pathname === '/admin/navigation'
                ? 'border-cyan-400 bg-cyan-400/15 text-cyan-200'
                : 'border-white/15 bg-white/5 text-slate-300 hover:bg-white/10 hover:text-white'
            }`}
          >
            <Settings2 className="h-4 w-4" />
            Edit navigation
          </Link>
        )}
      </div>
    </nav>
  )
}
