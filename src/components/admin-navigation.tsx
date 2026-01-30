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
  ChevronDown,
  Eye,
  Award,
  Truck,
  Store,
} from 'lucide-react'

interface NavTab {
  name: string
  href: string
  icon: React.ComponentType<{ className?: string }>
  active: boolean
  description: string
}

function NavDropdown({
  label,
  icon: Icon,
  isOpen,
  onToggle,
  onClose,
  isActive,
  tabs,
}: {
  label: string
  icon: React.ComponentType<{ className?: string }>
  isOpen: boolean
  onToggle: () => void
  onClose: () => void
  isActive: boolean
  tabs: NavTab[]
}) {
  return (
    <div className="relative">
      <button
        onClick={onToggle}
        className={`flex items-center gap-2 border-b-2 px-1 py-3 text-sm font-medium transition-colors ${
          isActive
            ? 'border-primary text-primary'
            : 'text-muted-foreground hover:border-border hover:text-foreground border-transparent'
        }`}
      >
        <Icon className="h-4 w-4" />
        {label}
        <ChevronDown
          className={`h-3 w-3 transition-transform ${isOpen ? 'rotate-180' : ''}`}
        />
      </button>

      {isOpen && (
        <>
          <div className="fixed inset-0 z-10" onClick={onClose} />
          <div className="bg-background absolute top-full left-0 z-20 mt-1 w-64 rounded-lg border shadow-lg">
            <div className="p-2">
              {tabs.map((tab) => {
                const TabIcon = tab.icon
                return (
                  <Link
                    key={tab.name}
                    href={tab.href}
                    onClick={onClose}
                    className={`flex items-start gap-3 rounded-md px-3 py-2 transition-colors ${
                      tab.active
                        ? 'bg-primary/10 text-primary'
                        : 'hover:bg-muted'
                    }`}
                  >
                    <TabIcon className="mt-0.5 h-4 w-4 flex-shrink-0" />
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
  )
}

export function AdminNavigation() {
  const pathname = usePathname()
  const [operationsOpen, setOperationsOpen] = useState(false)
  const [leadsOpen, setLeadsOpen] = useState(false)
  const [vendorsOpen, setVendorsOpen] = useState(false)
  const [previewOpen, setPreviewOpen] = useState(false)

  // Close all dropdowns
  const closeAll = () => {
    setOperationsOpen(false)
    setLeadsOpen(false)
    setVendorsOpen(false)
    setPreviewOpen(false)
  }

  // Operations group (Jobs + Stats)
  const operationsTabs: NavTab[] = [
    {
      name: 'Jobs',
      href: '/admin',
      icon: Briefcase,
      active: pathname === '/admin',
      description: 'Manage completed jobs',
    },
    {
      name: 'Stats',
      href: '/admin/stats',
      icon: BarChart3,
      active: pathname === '/admin/stats',
      description: 'Revenue & utilization tracking',
    },
  ]

  // Leads group (from truck/contest)
  const leadsTabs: NavTab[] = [
    {
      name: 'All Leads',
      href: '/admin/leads',
      icon: Phone,
      active: pathname === '/admin/leads',
      description: 'Lead pipeline & follow-ups',
    },
    {
      name: 'Contest',
      href: '/admin/sightings',
      icon: Trophy,
      active: pathname === '/admin/sightings',
      description: 'Sasquatch sightings entries',
    },
    {
      name: 'AI Chat',
      href: '/admin/conversations',
      icon: MessageSquare,
      active: pathname === '/admin/conversations',
      description: 'Text message dispatcher',
    },
  ]

  // Vendors group (local businesses)
  const vendorsTabs: NavTab[] = [
    {
      name: 'Vendor List',
      href: '/admin/location-partners',
      icon: Store,
      active: pathname === '/admin/location-partners',
      description: 'Manage vendor locations',
    },
    {
      name: 'NFC Analytics',
      href: '/admin/tap-analytics',
      icon: CreditCard,
      active: pathname === '/admin/tap-analytics',
      description: 'Card tap statistics',
    },
    {
      name: 'Vendor Chats',
      href: '/admin/conversations?source=vendor',
      icon: MessageSquare,
      active: false, // TODO: Check URL params when filtering is implemented
      description: 'AI chats from vendor cards',
    },
  ]

  // Check active states for dropdown highlights
  const operationsActive = operationsTabs.some((tab) => tab.active)
  const leadsActive = leadsTabs.some((tab) => tab.active)
  const vendorsActive = vendorsTabs.some((tab) => tab.active)
  const partnersActive = pathname === '/admin/partners'

  return (
    <div className="border-b">
      <nav
        className="-mb-px flex flex-wrap items-center gap-4 sm:gap-6"
        aria-label="Tabs"
      >
        {/* Operations Dropdown */}
        <NavDropdown
          label="Operations"
          icon={Truck}
          isOpen={operationsOpen}
          onToggle={() => {
            closeAll()
            setOperationsOpen(!operationsOpen)
          }}
          onClose={closeAll}
          isActive={operationsActive}
          tabs={operationsTabs}
        />

        {/* Leads Dropdown */}
        <NavDropdown
          label="Leads"
          icon={Phone}
          isOpen={leadsOpen}
          onToggle={() => {
            closeAll()
            setLeadsOpen(!leadsOpen)
          }}
          onClose={closeAll}
          isActive={leadsActive}
          tabs={leadsTabs}
        />

        {/* Vendors Dropdown */}
        <NavDropdown
          label="Vendors"
          icon={Store}
          isOpen={vendorsOpen}
          onToggle={() => {
            closeAll()
            setVendorsOpen(!vendorsOpen)
          }}
          onClose={closeAll}
          isActive={vendorsActive}
          tabs={vendorsTabs}
        />

        {/* Partners - standalone link */}
        <Link
          href="/admin/partners"
          className={`flex items-center gap-2 border-b-2 px-1 py-3 text-sm font-medium transition-colors ${
            partnersActive
              ? 'border-primary text-primary'
              : 'text-muted-foreground hover:border-border hover:text-foreground border-transparent'
          }`}
        >
          <Users className="h-4 w-4" />
          Partners
        </Link>

        {/* Preview Pages dropdown */}
        <div className="relative ml-auto">
          <button
            onClick={() => {
              closeAll()
              setPreviewOpen(!previewOpen)
            }}
            className="flex items-center gap-2 rounded-md bg-green-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-green-700"
          >
            <Eye className="h-4 w-4" />
            Preview
            <ChevronDown
              className={`h-3 w-3 transition-transform ${previewOpen ? 'rotate-180' : ''}`}
            />
          </button>

          {previewOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={closeAll} />
              <div className="bg-background absolute top-full right-0 z-20 mt-1 w-72 rounded-lg border shadow-lg">
                <div className="p-2">
                  <div className="text-muted-foreground px-3 py-1 text-xs font-semibold uppercase">
                    Lead Generation
                  </div>
                  <a
                    href="/tap"
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={closeAll}
                    className="hover:bg-muted flex items-center gap-3 rounded-md px-3 py-2"
                  >
                    <CreditCard className="h-4 w-4 text-blue-500" />
                    <div>
                      <div className="text-sm font-medium">Business Card</div>
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
                    onClick={closeAll}
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
                    Vendor Pages
                  </div>
                  <a
                    href="/location/demo"
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={closeAll}
                    className="hover:bg-muted flex items-center gap-3 rounded-md px-3 py-2"
                  >
                    <MapPin className="h-4 w-4 text-red-500" />
                    <div>
                      <div className="text-sm font-medium">Vendor Landing</div>
                      <div className="text-muted-foreground text-xs">
                        What customers see at vendor locations
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
                    href="/partners/register"
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={closeAll}
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
                    onClick={closeAll}
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
              </div>
            </>
          )}
        </div>
      </nav>
    </div>
  )
}
