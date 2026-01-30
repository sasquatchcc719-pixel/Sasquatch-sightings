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
  Eye,
  Globe,
  Award,
} from 'lucide-react'

export function AdminNavigation() {
  const pathname = usePathname()
  const [moreOpen, setMoreOpen] = useState(false)
  const [previewOpen, setPreviewOpen] = useState(false)

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
              </div>
            </>
          )}
        </div>

        {/* Preview Pages dropdown */}
        <div className="relative ml-auto">
          <button
            onClick={() => setPreviewOpen(!previewOpen)}
            className="text-muted-foreground hover:text-foreground flex items-center gap-2 rounded-md bg-green-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-green-700"
          >
            <Eye className="h-4 w-4" />
            Preview
            <ChevronDown
              className={`h-3 w-3 transition-transform ${previewOpen ? 'rotate-180' : ''}`}
            />
          </button>

          {previewOpen && (
            <>
              {/* Backdrop */}
              <div
                className="fixed inset-0 z-10"
                onClick={() => setPreviewOpen(false)}
              />

              {/* Dropdown */}
              <div className="bg-background absolute top-full right-0 z-20 mt-1 w-72 rounded-lg border shadow-lg">
                <div className="p-2">
                  <div className="text-muted-foreground px-3 py-1 text-xs font-semibold uppercase">
                    Customer-Facing Pages
                  </div>
                  <a
                    href="/tap"
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => setPreviewOpen(false)}
                    className="hover:bg-muted flex items-center gap-3 rounded-md px-3 py-2"
                  >
                    <CreditCard className="h-4 w-4 text-blue-500" />
                    <div>
                      <div className="text-sm font-medium">
                        Business Card Page
                      </div>
                      <div className="text-muted-foreground text-xs">
                        Your NFC card landing page
                      </div>
                    </div>
                    <ExternalLink className="ml-auto h-3 w-3" />
                  </a>
                  <a
                    href="/contest"
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => setPreviewOpen(false)}
                    className="hover:bg-muted flex items-center gap-3 rounded-md px-3 py-2"
                  >
                    <Trophy className="h-4 w-4 text-amber-500" />
                    <div>
                      <div className="text-sm font-medium">Contest Page</div>
                      <div className="text-muted-foreground text-xs">
                        Sasquatch sightings contest
                      </div>
                    </div>
                    <ExternalLink className="ml-auto h-3 w-3" />
                  </a>
                </div>

                <div className="border-t p-2">
                  <div className="text-muted-foreground px-3 py-1 text-xs font-semibold uppercase">
                    Partner Pages
                  </div>
                  <a
                    href="/partners"
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => setPreviewOpen(false)}
                    className="hover:bg-muted flex items-center gap-3 rounded-md px-3 py-2"
                  >
                    <Users className="h-4 w-4 text-purple-500" />
                    <div>
                      <div className="text-sm font-medium">Partner Signup</div>
                      <div className="text-muted-foreground text-xs">
                        Referral partner registration
                      </div>
                    </div>
                    <ExternalLink className="ml-auto h-3 w-3" />
                  </a>
                  <a
                    href="/preferred-partners"
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => setPreviewOpen(false)}
                    className="hover:bg-muted flex items-center gap-3 rounded-md px-3 py-2"
                  >
                    <Award className="h-4 w-4 text-green-500" />
                    <div>
                      <div className="text-sm font-medium">
                        Preferred Partners
                      </div>
                      <div className="text-muted-foreground text-xs">
                        Public partner directory
                      </div>
                    </div>
                    <ExternalLink className="ml-auto h-3 w-3" />
                  </a>
                </div>

                <div className="border-t p-2">
                  <div className="text-muted-foreground px-3 py-1 text-xs font-semibold uppercase">
                    Location Partner Demo
                  </div>
                  <a
                    href="/location/demo"
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => setPreviewOpen(false)}
                    className="hover:bg-muted flex items-center gap-3 rounded-md px-3 py-2"
                  >
                    <MapPin className="h-4 w-4 text-red-500" />
                    <div>
                      <div className="text-sm font-medium">
                        Location Partner Page
                      </div>
                      <div className="text-muted-foreground text-xs">
                        What vendors see when card is scanned
                      </div>
                    </div>
                    <ExternalLink className="ml-auto h-3 w-3" />
                  </a>
                  <p className="text-muted-foreground px-3 py-1 text-xs">
                    Tip: Get real partner URLs from Location Partners admin
                  </p>
                </div>
              </div>
            </>
          )}
        </div>
      </nav>
    </div>
  )
}
