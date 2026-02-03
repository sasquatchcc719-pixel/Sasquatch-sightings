'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
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
  Map,
  Bot,
  Target,
  Link2,
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
        className={`flex w-full items-center justify-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition-all sm:w-auto sm:justify-start ${
          isActive
            ? 'bg-green-600 text-white shadow-lg shadow-green-600/30'
            : 'bg-white/20 text-white/70 backdrop-blur-sm hover:bg-white/30 hover:text-white'
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
          <div className="fixed inset-0 z-[100]" onClick={onClose} />
          <div className="absolute top-full left-0 z-[110] mt-2 w-64 rounded-xl border border-white/20 bg-black shadow-2xl">
            <div className="p-2">
              {tabs.map((tab) => {
                const TabIcon = tab.icon
                return (
                  <Link
                    key={tab.name}
                    href={tab.href}
                    onClick={onClose}
                    className={`flex items-start gap-3 rounded-lg px-3 py-2 transition-colors ${
                      tab.active
                        ? 'bg-green-600/30 text-green-400'
                        : 'text-white/80 hover:bg-white/10 hover:text-white'
                    }`}
                  >
                    <TabIcon className="mt-0.5 h-4 w-4 flex-shrink-0" />
                    <div>
                      <div className="text-sm font-medium">{tab.name}</div>
                      <div className="text-xs text-white/50">
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
  const searchParams = useSearchParams()
  const isVendorSource = searchParams.get('source') === 'vendor'
  const [operationsOpen, setOperationsOpen] = useState(false)
  const [leadsOpen, setLeadsOpen] = useState(false)
  const [vendorsOpen, setVendorsOpen] = useState(false)
  const [analystOpen, setAnalystOpen] = useState(false)
  const [previewOpen, setPreviewOpen] = useState(false)

  // Close all dropdowns
  const closeAll = () => {
    setOperationsOpen(false)
    setLeadsOpen(false)
    setVendorsOpen(false)
    setAnalystOpen(false)
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
      name: 'Business Cards',
      href: '/admin/tap-analytics',
      icon: CreditCard,
      active: pathname === '/admin/tap-analytics',
      description: 'Your personal NFC card taps',
    },
    {
      name: 'Contest',
      href: '/admin/sightings',
      icon: Trophy,
      active: pathname === '/admin/sightings',
      description: 'Sightings & conversations',
    },
  ]

  // Vendors group (local businesses)
  const vendorsTabs: NavTab[] = [
    {
      name: 'Vendor List',
      href: '/admin/location-partners',
      icon: Store,
      active: pathname === '/admin/location-partners',
      description: 'Manage vendor locations & station health',
    },
    {
      name: 'Vendor Chats',
      href: '/admin/conversations?source=vendor',
      icon: MessageSquare,
      active: pathname === '/admin/conversations' && isVendorSource,
      description: 'AI chats from vendor cards',
    },
  ]

  // Analyst group (Harry)
  const analystTabs: NavTab[] = [
    {
      name: 'Chat',
      href: '/admin/analyst',
      icon: MessageSquare,
      active: pathname === '/admin/analyst',
      description: 'Talk to Harry',
    },
    {
      name: 'Targets',
      href: '/admin/analyst/targets',
      icon: Target,
      active: pathname === '/admin/analyst/targets',
      description: 'Market intel config',
    },
  ]

  // Check active states for dropdown highlights
  const operationsActive = operationsTabs.some((tab) => tab.active)
  const leadsActive = leadsTabs.some((tab) => tab.active)
  const vendorsActive = vendorsTabs.some((tab) => tab.active)
  const analystActive = analystTabs.some((tab) => tab.active)
  const partnersActive = pathname === '/admin/partners'
  const callsActive =
    pathname === '/admin/conversations' &&
    searchParams.get('source') === 'phone'

  return (
    <div>
      <nav aria-label="Tabs">
        {/* Mobile: 2-column grid, Desktop: flex row */}
        <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center sm:gap-4">
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
            className={`flex items-center justify-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition-all sm:justify-start ${
              partnersActive
                ? 'bg-green-600 text-white shadow-lg shadow-green-600/30'
                : 'bg-white/20 text-white/70 backdrop-blur-sm hover:bg-white/30 hover:text-white'
            }`}
          >
            <Users className="h-4 w-4" />
            Partners
          </Link>

          {/* Calls - standalone link for voicemails/phone */}
          <Link
            href="/admin/conversations?source=phone"
            className={`flex items-center justify-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition-all sm:justify-start ${
              callsActive
                ? 'bg-green-600 text-white shadow-lg shadow-green-600/30'
                : 'bg-white/20 text-white/70 backdrop-blur-sm hover:bg-white/30 hover:text-white'
            }`}
          >
            <Phone className="h-4 w-4" />
            Calls
          </Link>

          {/* Analyst Dropdown (Harry) */}
          <NavDropdown
            label="Analyst"
            icon={Bot}
            isOpen={analystOpen}
            onToggle={() => {
              closeAll()
              setAnalystOpen(!analystOpen)
            }}
            onClose={closeAll}
            isActive={analystActive}
            tabs={analystTabs}
          />

          {/* Preview Pages dropdown */}
          <div className="relative col-span-2 sm:col-span-1">
            <button
              onClick={() => {
                closeAll()
                setPreviewOpen(!previewOpen)
              }}
              className="flex w-full items-center justify-center gap-2 rounded-full bg-white/20 px-4 py-2 text-sm font-medium text-white/70 backdrop-blur-sm transition-all hover:bg-white/30 hover:text-white sm:w-auto sm:justify-start"
            >
              <Eye className="h-4 w-4" />
              Preview
              <ChevronDown
                className={`h-3 w-3 transition-transform ${previewOpen ? 'rotate-180' : ''}`}
              />
            </button>

            {previewOpen && (
              <>
                <div className="fixed inset-0 z-[100]" onClick={closeAll} />
                <div className="absolute top-full right-0 z-[110] mt-2 max-h-[70vh] w-72 overflow-y-auto rounded-xl border border-white/20 bg-black shadow-2xl">
                  <div className="p-2">
                    <div className="px-3 py-1 text-xs font-semibold text-white/50 uppercase">
                      Lead Generation
                    </div>
                    <a
                      href="/tap"
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={closeAll}
                      className="flex items-center gap-3 rounded-lg px-3 py-2 text-white/80 transition-colors hover:bg-white/10 hover:text-white"
                    >
                      <CreditCard className="h-4 w-4 text-blue-400" />
                      <div>
                        <div className="text-sm font-medium">Business Card</div>
                        <div className="text-xs text-white/50">
                          Your NFC card landing page
                        </div>
                      </div>
                      <ExternalLink className="ml-auto h-3 w-3" />
                    </a>
                    <a
                      href="/sightings"
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={closeAll}
                      className="flex items-center gap-3 rounded-lg px-3 py-2 text-white/80 transition-colors hover:bg-white/10 hover:text-white"
                    >
                      <Trophy className="h-4 w-4 text-amber-400" />
                      <div>
                        <div className="text-sm font-medium">Contest Page</div>
                        <div className="text-xs text-white/50">
                          Sasquatch sightings contest
                        </div>
                      </div>
                      <ExternalLink className="ml-auto h-3 w-3" />
                    </a>
                    <a
                      href="/links"
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={closeAll}
                      className="flex items-center gap-3 rounded-lg px-3 py-2 text-white/80 transition-colors hover:bg-white/10 hover:text-white"
                    >
                      <Link2 className="h-4 w-4 text-green-400" />
                      <div>
                        <div className="text-sm font-medium">
                          Review & Share
                        </div>
                        <div className="text-xs text-white/50">
                          Post-service follow-up page
                        </div>
                      </div>
                      <ExternalLink className="ml-auto h-3 w-3" />
                    </a>
                    <a
                      href="/"
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={closeAll}
                      className="flex items-center gap-3 rounded-lg px-3 py-2 text-white/80 transition-colors hover:bg-white/10 hover:text-white"
                    >
                      <Map className="h-4 w-4 text-green-400" />
                      <div>
                        <div className="text-sm font-medium">Sightings Map</div>
                        <div className="text-xs text-white/50">
                          Public map of sightings
                        </div>
                      </div>
                      <ExternalLink className="ml-auto h-3 w-3" />
                    </a>
                  </div>

                  <div className="border-t border-white/10 p-2">
                    <div className="px-3 py-1 text-xs font-semibold text-white/50 uppercase">
                      Vendor Pages
                    </div>
                    <a
                      href="/location/demo"
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={closeAll}
                      className="flex items-center gap-3 rounded-lg px-3 py-2 text-white/80 transition-colors hover:bg-white/10 hover:text-white"
                    >
                      <MapPin className="h-4 w-4 text-red-400" />
                      <div>
                        <div className="text-sm font-medium">
                          Vendor Landing
                        </div>
                        <div className="text-xs text-white/50">
                          What customers see at vendor locations
                        </div>
                      </div>
                      <ExternalLink className="ml-auto h-3 w-3" />
                    </a>
                  </div>

                  <div className="border-t border-white/10 p-2">
                    <div className="px-3 py-1 text-xs font-semibold text-white/50 uppercase">
                      Partner Pages
                    </div>
                    <a
                      href="/partners/register"
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={closeAll}
                      className="flex items-center gap-3 rounded-lg px-3 py-2 text-white/80 transition-colors hover:bg-white/10 hover:text-white"
                    >
                      <Users className="h-4 w-4 text-purple-400" />
                      <div>
                        <div className="text-sm font-medium">
                          Partner Signup
                        </div>
                        <div className="text-xs text-white/50">
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
                      className="flex items-center gap-3 rounded-lg px-3 py-2 text-white/80 transition-colors hover:bg-white/10 hover:text-white"
                    >
                      <Award className="h-4 w-4 text-green-400" />
                      <div>
                        <div className="text-sm font-medium">
                          Preferred Partners
                        </div>
                        <div className="text-xs text-white/50">
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
        </div>
      </nav>
    </div>
  )
}
