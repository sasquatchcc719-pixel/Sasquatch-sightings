'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import {
  Briefcase,
  Trophy,
  Users,
  ExternalLink,
  Calendar,
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
  Megaphone,
  ImagePlay,
  Mail,
  ClipboardList,
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
            ? 'bg-gradient-to-r from-emerald-500 to-cyan-500 text-slate-950 shadow-[0_0_20px_rgba(16,185,129,0.35)]'
            : 'bg-white/10 text-slate-100 hover:bg-white/20 hover:text-white'
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
          <div className="border-border bg-popover text-popover-foreground absolute top-full left-0 z-[110] mt-2 w-64 rounded-xl border shadow-2xl">
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
                        ? 'bg-primary/10 text-primary'
                        : 'text-foreground/80 hover:bg-accent hover:text-accent-foreground'
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
  const searchParams = useSearchParams()
  const isAIChatsSource = searchParams.get('source') === 'ai_chats'
  const [operationsOpen, setOperationsOpen] = useState(false)
  const [marketingOpen, setMarketingOpen] = useState(false)
  const [callsOpen, setCallsOpen] = useState(false)
  const [aiOpen, setAiOpen] = useState(false)
  const [previewOpen, setPreviewOpen] = useState(false)

  // Close all dropdowns
  const closeAll = () => {
    setOperationsOpen(false)
    setMarketingOpen(false)
    setCallsOpen(false)
    setAiOpen(false)
    setPreviewOpen(false)
  }

  // Operations group (Jobs + Stats)
  const operationsTabs: NavTab[] = [
    {
      name: 'Operations',
      href: '/admin/operations',
      icon: Calendar,
      active: pathname === '/admin/operations',
      description: 'Internal booking, calendar, invoices, and sync queue',
    },
    {
      name: 'Jobs',
      href: '/admin/jobs',
      icon: Briefcase,
      active: pathname === '/admin/jobs',
      description: 'Manage completed jobs',
    },
    {
      name: 'Stats',
      href: '/admin/stats',
      icon: BarChart3,
      active: pathname === '/admin/stats',
      description: 'Revenue & utilization tracking',
    },
    {
      name: 'Radar',
      href: '/admin/radar',
      icon: Target,
      active: pathname === '/admin/radar',
      description: 'Competitor SERP rank tracking',
    },
  ]

  // Marketing group (leads, vendors, partners, cards, contest)
  const marketingTabs: NavTab[] = [
    {
      name: 'Card Analytics',
      href: '/admin/tap-analytics',
      icon: BarChart3,
      active: pathname === '/admin/tap-analytics',
      description: 'Business card taps, clicks, and conversion breakdown',
    },
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
      description: 'Sightings & contest entries',
    },
    {
      name: 'Vendors',
      href: '/admin/vendors',
      icon: Store,
      active: pathname === '/admin/vendors',
      description: 'Manage vendor locations & station health',
    },
    {
      name: 'Partners',
      href: '/admin/partners',
      icon: Users,
      active: pathname === '/admin/partners',
      description: 'Referral partners',
    },
    {
      name: 'Push',
      href: '/admin/push',
      icon: Megaphone,
      active: pathname === '/admin/push',
      description: 'Send push notifications',
    },
    {
      name: 'Social Posts',
      href: '/admin/social-posts',
      icon: ImagePlay,
      active: pathname === '/admin/social-posts',
      description: 'GBP job posts, offers & event campaigns',
    },
  ]

  // AI controls (Harry + George + AI Chats)
  const aiTabs: NavTab[] = [
    {
      name: 'Control',
      href: '/admin/harry/control',
      icon: Bot,
      active: pathname === '/admin/harry/control',
      description: 'Runtime toggles, logic profiles, and knowledge controls',
    },
    {
      name: 'George Henderson',
      href: '/admin/harry/george',
      icon: Bot,
      active: pathname === '/admin/harry/george',
      description: 'Smart field copilot with confirmation-gated actions',
    },
    {
      name: 'AI Chats',
      href: '/admin/conversations?source=ai_chats',
      icon: MessageSquare,
      active: pathname === '/admin/conversations' && isAIChatsSource,
      description: 'All AI-initiated chats (vendor, card, contest)',
    },
    {
      name: 'Capabilities',
      href: '/admin/harry/capabilities',
      icon: ClipboardList,
      active: pathname === '/admin/harry/capabilities',
      description: 'What Harry and George can and cannot do',
    },
  ]

  // Comms group (Phone system + email)
  const callsTabs: NavTab[] = [
    {
      name: 'Phone',
      href: '/admin/phone',
      icon: Phone,
      active: pathname === '/admin/phone',
      description: 'Make outbound calls from your browser',
    },
    {
      name: 'Direct Texts',
      href: '/admin/conversations?source=phone',
      icon: MessageSquare,
      active:
        pathname === '/admin/conversations' &&
        searchParams.get('source') === 'phone',
      description: 'Texts from people who contacted your number directly',
    },
    {
      name: 'SMS Outbox',
      href: '/admin/sms-outbox',
      icon: MessageSquare,
      active: pathname === '/admin/sms-outbox',
      description: 'Outbound Operations texts (booking, on my way, job done)',
    },
    {
      name: 'Email Outbox',
      href: '/admin/email-outbox',
      icon: Mail,
      active: pathname === '/admin/email-outbox',
      description: 'Emails sent to customers',
    },
    {
      name: 'Voicemails',
      href: '/admin/voicemails',
      icon: Phone,
      active: pathname === '/admin/voicemails',
      description: 'Voicemail recordings',
    },
    {
      name: 'Settings',
      href: '/admin/phone-settings',
      icon: Phone,
      active: pathname === '/admin/phone-settings',
      description: 'Voicemail message, hours & routing',
    },
  ]

  // Check active states for dropdown highlights
  const operationsActive = operationsTabs.some((tab) => tab.active)
  const marketingActive = marketingTabs.some((tab) => tab.active)
  const callsActive = callsTabs.some((tab) => tab.active)
  const aiActive = aiTabs.some((tab) => tab.active)

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

          {/* Marketing Dropdown */}
          <NavDropdown
            label="Marketing"
            icon={Megaphone}
            isOpen={marketingOpen}
            onToggle={() => {
              closeAll()
              setMarketingOpen(!marketingOpen)
            }}
            onClose={closeAll}
            isActive={marketingActive}
            tabs={marketingTabs}
          />

          {/* Comms Dropdown */}
          <NavDropdown
            label="Comms"
            icon={Phone}
            isOpen={callsOpen}
            onToggle={() => {
              closeAll()
              setCallsOpen(!callsOpen)
            }}
            onClose={closeAll}
            isActive={callsActive}
            tabs={callsTabs}
          />

          {/* AI Controls Dropdown */}
          <NavDropdown
            label="AI"
            icon={Bot}
            isOpen={aiOpen}
            onToggle={() => {
              closeAll()
              setAiOpen(!aiOpen)
            }}
            onClose={closeAll}
            isActive={aiActive}
            tabs={aiTabs}
          />

          {/* Preview Pages dropdown */}
          <div className="relative col-span-2 sm:col-span-1">
            <button
              onClick={() => {
                closeAll()
                setPreviewOpen(!previewOpen)
              }}
              className="flex w-full items-center justify-center gap-2 rounded-full bg-white/10 px-4 py-2 text-sm font-medium text-slate-100 transition-all hover:bg-white/20 hover:text-white sm:w-auto sm:justify-start"
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
                <div className="border-border bg-popover text-popover-foreground absolute top-full right-0 z-[110] mt-2 max-h-[70vh] w-72 overflow-y-auto rounded-xl border shadow-2xl">
                  <div className="p-2">
                    <div className="text-muted-foreground px-3 py-1 text-xs font-semibold uppercase">
                      Lead Generation
                    </div>
                    <a
                      href="/tap"
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={closeAll}
                      className="text-foreground/80 hover:bg-accent hover:text-accent-foreground flex items-center gap-3 rounded-lg px-3 py-2 transition-colors"
                    >
                      <CreditCard className="h-4 w-4 text-blue-400" />
                      <div>
                        <div className="text-sm font-medium">Business Card</div>
                        <div className="text-muted-foreground text-xs">
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
                      className="text-foreground/80 hover:bg-accent hover:text-accent-foreground flex items-center gap-3 rounded-lg px-3 py-2 transition-colors"
                    >
                      <Trophy className="h-4 w-4 text-amber-400" />
                      <div>
                        <div className="text-sm font-medium">Contest Page</div>
                        <div className="text-muted-foreground text-xs">
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
                      className="text-foreground/80 hover:bg-accent hover:text-accent-foreground flex items-center gap-3 rounded-lg px-3 py-2 transition-colors"
                    >
                      <Link2 className="h-4 w-4 text-green-400" />
                      <div>
                        <div className="text-sm font-medium">
                          Review & Share
                        </div>
                        <div className="text-muted-foreground text-xs">
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
                      className="text-foreground/80 hover:bg-accent hover:text-accent-foreground flex items-center gap-3 rounded-lg px-3 py-2 transition-colors"
                    >
                      <Map className="h-4 w-4 text-green-400" />
                      <div>
                        <div className="text-sm font-medium">Sightings Map</div>
                        <div className="text-muted-foreground text-xs">
                          Public map of sightings
                        </div>
                      </div>
                      <ExternalLink className="ml-auto h-3 w-3" />
                    </a>
                  </div>

                  <div className="border-border/60 border-t p-2">
                    <div className="text-muted-foreground px-3 py-1 text-xs font-semibold uppercase">
                      Vendor Pages
                    </div>
                    <a
                      href="/location/demo"
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={closeAll}
                      className="text-foreground/80 hover:bg-accent hover:text-accent-foreground flex items-center gap-3 rounded-lg px-3 py-2 transition-colors"
                    >
                      <MapPin className="h-4 w-4 text-red-400" />
                      <div>
                        <div className="text-sm font-medium">
                          Vendor Landing
                        </div>
                        <div className="text-muted-foreground text-xs">
                          What customers see at vendor locations
                        </div>
                      </div>
                      <ExternalLink className="ml-auto h-3 w-3" />
                    </a>
                    <a
                      href="/location/demo/contest"
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={closeAll}
                      className="text-foreground/80 hover:bg-accent hover:text-accent-foreground flex items-center gap-3 rounded-lg px-3 py-2 transition-colors"
                    >
                      <Trophy className="h-4 w-4 text-amber-400" />
                      <div>
                        <div className="text-sm font-medium">
                          Vendor Contest
                        </div>
                        <div className="text-muted-foreground text-xs">
                          Vendor-specific contest page
                        </div>
                      </div>
                      <ExternalLink className="ml-auto h-3 w-3" />
                    </a>
                  </div>

                  <div className="border-border/60 border-t p-2">
                    <div className="text-muted-foreground px-3 py-1 text-xs font-semibold uppercase">
                      Partner Pages
                    </div>
                    <a
                      href="/partners/register"
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={closeAll}
                      className="text-foreground/80 hover:bg-accent hover:text-accent-foreground flex items-center gap-3 rounded-lg px-3 py-2 transition-colors"
                    >
                      <Users className="h-4 w-4 text-purple-400" />
                      <div>
                        <div className="text-sm font-medium">
                          Partner Signup
                        </div>
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
                      className="text-foreground/80 hover:bg-accent hover:text-accent-foreground flex items-center gap-3 rounded-lg px-3 py-2 transition-colors"
                    >
                      <Award className="h-4 w-4 text-green-400" />
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
        </div>
      </nav>
    </div>
  )
}
