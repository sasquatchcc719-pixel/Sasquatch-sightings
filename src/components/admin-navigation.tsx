'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  Briefcase,
  Trophy,
  Users,
  ExternalLink,
  Phone,
  MessageSquare,
  BarChart3,
  CreditCard,
  MapPin,
  Menu,
  ChevronDown,
} from 'lucide-react'

export function AdminNavigation() {
  const pathname = usePathname()
  const [moreOpen, setMoreOpen] = useState(false)

  // Primary tabs - always visible
  const primaryTabs = [
    {
      name: 'Jobs',
      href: '/admin',
      icon: Briefcase,
      active: pathname === '/admin',
    },
    {
      name: 'Stats',
      href: '/admin/stats',
      icon: BarChart3,
      active: pathname === '/admin/stats',
    },
    {
      name: 'Leads',
      href: '/admin/leads',
      icon: Phone,
      active: pathname === '/admin/leads',
    },
    {
      name: 'AI Chat',
      href: '/admin/conversations',
      icon: MessageSquare,
      active: pathname === '/admin/conversations',
    },
  ]

  // Secondary tabs - in dropdown
  const secondaryTabs = [
    {
      name: 'NFC Cards',
      href: '/admin/tap-analytics',
      icon: CreditCard,
      active: pathname === '/admin/tap-analytics',
      description: 'Business card analytics',
    },
    {
      name: 'Location Partners',
      href: '/admin/location-partners',
      icon: MapPin,
      active: pathname === '/admin/location-partners',
      description: 'NFC cards at local businesses',
    },
    {
      name: 'Referral Partners',
      href: '/admin/partners',
      icon: Users,
      active: pathname === '/admin/partners',
      description: 'Partner referral program',
    },
    {
      name: 'Contest',
      href: '/admin/sightings',
      icon: Trophy,
      active: pathname === '/admin/sightings',
      description: 'Sasquatch sightings contest',
    },
  ]

  // Check if any secondary tab is active
  const secondaryActive = secondaryTabs.some((tab) => tab.active)

  return (
    <div className="border-b">
      <nav
        className="-mb-px flex flex-wrap items-center gap-4 sm:gap-6"
        aria-label="Tabs"
      >
        {/* Primary tabs */}
        {primaryTabs.map((tab) => {
          const Icon = tab.icon
          return (
            <Link
              key={tab.name}
              href={tab.href}
              className={`flex items-center gap-2 border-b-2 px-1 py-3 text-sm font-medium transition-colors ${
                tab.active
                  ? 'border-primary text-primary'
                  : 'text-muted-foreground hover:border-border hover:text-foreground border-transparent'
              }`}
            >
              <Icon className="h-4 w-4" />
              {tab.name}
            </Link>
          )
        })}

        {/* More dropdown */}
        <div className="relative">
          <button
            onClick={() => setMoreOpen(!moreOpen)}
            className={`flex items-center gap-2 border-b-2 px-1 py-3 text-sm font-medium transition-colors ${
              secondaryActive
                ? 'border-primary text-primary'
                : 'text-muted-foreground hover:border-border hover:text-foreground border-transparent'
            }`}
          >
            <Menu className="h-4 w-4" />
            More
            <ChevronDown
              className={`h-3 w-3 transition-transform ${moreOpen ? 'rotate-180' : ''}`}
            />
          </button>

          {moreOpen && (
            <>
              {/* Backdrop */}
              <div
                className="fixed inset-0 z-10"
                onClick={() => setMoreOpen(false)}
              />

              {/* Dropdown */}
              <div className="bg-background absolute top-full left-0 z-20 mt-1 w-64 rounded-lg border shadow-lg">
                <div className="p-2">
                  {secondaryTabs.map((tab) => {
                    const Icon = tab.icon
                    return (
                      <Link
                        key={tab.name}
                        href={tab.href}
                        onClick={() => setMoreOpen(false)}
                        className={`flex items-start gap-3 rounded-md px-3 py-2 transition-colors ${
                          tab.active
                            ? 'bg-primary/10 text-primary'
                            : 'hover:bg-muted'
                        }`}
                      >
                        <Icon className="mt-0.5 h-4 w-4 flex-shrink-0" />
                        <div>
                          <div className="text-sm font-medium">{tab.name}</div>
                          <div className="text-muted-foreground text-xs">
                            {tab.description}
                          </div>
                        </div>
                      </Link>
                    )
                  })}
                </div>

                {/* External links */}
                <div className="border-t p-2">
                  <div className="text-muted-foreground px-3 py-1 text-xs font-semibold uppercase">
                    Preview Pages
                  </div>
                  <a
                    href="/tap"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:bg-muted flex items-center gap-2 rounded-md px-3 py-2 text-sm"
                  >
                    <CreditCard className="h-4 w-4" />
                    Business Card Page
                    <ExternalLink className="ml-auto h-3 w-3" />
                  </a>
                  <a
                    href="/location/demo"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:bg-muted flex items-center gap-2 rounded-md px-3 py-2 text-sm"
                  >
                    <MapPin className="h-4 w-4" />
                    Location Partner Page
                    <ExternalLink className="ml-auto h-3 w-3" />
                  </a>
                  <a
                    href="/preferred-partners"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:bg-muted flex items-center gap-2 rounded-md px-3 py-2 text-sm"
                  >
                    <Users className="h-4 w-4" />
                    Public Partners Page
                    <ExternalLink className="ml-auto h-3 w-3" />
                  </a>
                </div>
              </div>
            </>
          )}
        </div>
      </nav>
    </div>
  )
}
