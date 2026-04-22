'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import {
  Menu,
  X,
  Truck,
  Megaphone,
  Phone,
  Bot,
  Eye,
  Calendar,
  Ruler,
  Briefcase,
  BarChart3,
  Target,
  CreditCard,
  Trophy,
  Store,
  Users,
  MessageSquare,
  Mail,
  ClipboardList,
  ExternalLink,
  MapPin,
  Map,
  Link2,
  Award,
  ChevronDown,
  LogOut,
} from 'lucide-react'
import { createClient } from '@/supabase/client'
import { useRouter } from 'next/navigation'

interface MobileHeaderProps {
  userEmail: string
}

interface NavItem {
  name: string
  href: string
  icon: React.ComponentType<{ className?: string }>
  description?: string
  external?: boolean
}

interface NavSection {
  label: string
  icon: React.ComponentType<{ className?: string }>
  items: NavItem[]
}

const navSections: NavSection[] = [
  {
    label: 'Operations',
    icon: Truck,
    items: [
      {
        name: 'Schedule',
        href: '/admin/operations',
        icon: Calendar,
        description: 'Calendar & bookings',
      },
      {
        name: 'Estimates',
        href: '/admin/operations/estimates',
        icon: Ruler,
        description: 'Line-item estimates',
      },
      {
        name: 'Jobs',
        href: '/admin/jobs',
        icon: Briefcase,
        description: 'Completed jobs',
      },
      {
        name: 'Stats',
        href: '/admin/stats',
        icon: BarChart3,
        description: 'Revenue & utilization',
      },
      {
        name: 'Radar',
        href: '/admin/radar',
        icon: Target,
        description: 'Competitor SERP ranks',
      },
    ],
  },
  {
    label: 'Marketing',
    icon: Megaphone,
    items: [
      {
        name: 'Card Analytics',
        href: '/admin/tap-analytics',
        icon: BarChart3,
        description: 'Business card taps',
      },
      {
        name: 'All Leads',
        href: '/admin/leads',
        icon: Phone,
        description: 'Lead pipeline',
      },
      {
        name: 'Contest',
        href: '/admin/sightings',
        icon: Trophy,
        description: 'Sightings entries',
      },
      {
        name: 'Vendors',
        href: '/admin/vendors',
        icon: Store,
        description: 'Vendor locations',
      },
      {
        name: 'Partners',
        href: '/admin/partners',
        icon: Users,
        description: 'Referral partners',
      },
      {
        name: 'Push',
        href: '/admin/push',
        icon: Megaphone,
        description: 'Push notifications',
      },
      {
        name: 'Social Posts',
        href: '/admin/social-posts',
        icon: Eye,
        description: 'GBP job posts',
      },
    ],
  },
  {
    label: 'Comms',
    icon: Phone,
    items: [
      {
        name: 'Phone',
        href: '/admin/phone',
        icon: Phone,
        description: 'Outbound calls',
      },
      {
        name: 'Direct Texts',
        href: '/admin/conversations?source=phone',
        icon: MessageSquare,
        description: 'Customer SMS',
      },
      {
        name: 'All Conversations',
        href: '/admin/conversations',
        icon: MessageSquare,
        description: 'All SMS threads',
      },
      {
        name: 'SMS Outbox',
        href: '/admin/sms-outbox',
        icon: MessageSquare,
        description: 'Outbound ops texts',
      },
      {
        name: 'Email Outbox',
        href: '/admin/email-outbox',
        icon: Mail,
        description: 'Customer emails',
      },
      {
        name: 'Voicemails',
        href: '/admin/voicemails',
        icon: Phone,
        description: 'Voicemail recordings',
      },
      {
        name: 'Templates & Drip',
        href: '/admin/operations/communications',
        icon: Mail,
        description: 'Lifecycle templates',
      },
      {
        name: 'Settings',
        href: '/admin/phone-settings',
        icon: Phone,
        description: 'Phone routing',
      },
    ],
  },
  {
    label: 'AI',
    icon: Bot,
    items: [
      {
        name: 'Control',
        href: '/admin/harry/control',
        icon: Bot,
        description: 'Runtime toggles',
      },
      {
        name: 'George Henderson',
        href: '/admin/harry/george',
        icon: Bot,
        description: 'Field copilot',
      },
      {
        name: 'AI Chats',
        href: '/admin/conversations?source=ai_chats',
        icon: MessageSquare,
        description: 'AI-initiated chats',
      },
      {
        name: 'Capabilities',
        href: '/admin/harry/capabilities',
        icon: ClipboardList,
        description: 'Harry & George abilities',
      },
    ],
  },
  {
    label: 'Preview',
    icon: Eye,
    items: [
      {
        name: 'Business Card',
        href: '/tap',
        icon: CreditCard,
        description: 'NFC card landing',
        external: true,
      },
      {
        name: 'Contest Page',
        href: '/sightings',
        icon: Trophy,
        description: 'Sightings contest',
        external: true,
      },
      {
        name: 'Review & Share',
        href: '/links',
        icon: Link2,
        description: 'Post-service follow-up',
        external: true,
      },
      {
        name: 'Sightings Map',
        href: '/',
        icon: Map,
        description: 'Public map',
        external: true,
      },
      {
        name: 'Vendor Landing',
        href: '/location/demo',
        icon: MapPin,
        description: 'Vendor page',
        external: true,
      },
      {
        name: 'Partner Signup',
        href: '/partners/register',
        icon: Users,
        description: 'Referral registration',
        external: true,
      },
      {
        name: 'Preferred Partners',
        href: '/preferred-partners',
        icon: Award,
        description: 'Partner directory',
        external: true,
      },
    ],
  },
]

function DrawerSection({
  section,
  pathname,
  onClose,
}: {
  section: NavSection
  pathname: string
  onClose: () => void
}) {
  const [open, setOpen] = useState(false)
  const Icon = section.icon

  return (
    <div className="border-b border-white/10 last:border-0">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between px-4 py-3 text-sm font-semibold text-slate-100"
      >
        <div className="flex items-center gap-2.5">
          <Icon className="h-4 w-4 text-emerald-400" />
          {section.label}
        </div>
        <ChevronDown
          className={`h-3.5 w-3.5 text-slate-400 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <div className="pb-2">
          {section.items.map((item) => {
            const ItemIcon = item.icon
            const isActive =
              pathname === item.href || pathname.startsWith(item.href + '?')

            if (item.external) {
              return (
                <a
                  key={item.name}
                  href={item.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={onClose}
                  className="flex items-center gap-3 px-5 py-2.5 transition-colors hover:bg-white/5"
                >
                  <ItemIcon className="h-3.5 w-3.5 flex-shrink-0 text-slate-400" />
                  <span className="text-sm text-slate-300">{item.name}</span>
                  <ExternalLink className="ml-auto h-3 w-3 text-slate-500" />
                </a>
              )
            }

            return (
              <Link
                key={item.name}
                href={item.href}
                onClick={onClose}
                className={`flex items-center gap-3 px-5 py-2.5 transition-colors ${
                  isActive
                    ? 'border-l-2 border-l-emerald-400 bg-emerald-500/10 text-emerald-300'
                    : 'border-l-2 border-l-transparent text-slate-300 hover:bg-white/5 hover:text-white'
                }`}
              >
                <ItemIcon
                  className={`h-3.5 w-3.5 flex-shrink-0 ${isActive ? 'text-emerald-400' : 'text-slate-400'}`}
                />
                <span className="text-sm">{item.name}</span>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}

export function MobileHeader({ userEmail }: MobileHeaderProps) {
  const [drawerOpen, setDrawerOpen] = useState(false)
  const pathname = usePathname()
  const router = useRouter()

  const handleLogout = async () => {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/auth/login')
  }

  const closeDrawer = () => setDrawerOpen(false)
  const username = userEmail?.split('@')[0] || 'Admin'

  return (
    <>
      {/* Mobile top bar */}
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
            onClick={() => void handleLogout()}
            className="flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5 text-xs text-slate-300 transition-colors hover:bg-white/20"
            aria-label="Log out"
          >
            <LogOut className="h-3.5 w-3.5" />
            <span>Log out</span>
          </button>
          <button
            onClick={() => setDrawerOpen(true)}
            className="flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-slate-100 transition-colors hover:bg-white/20"
            aria-label="Open menu"
          >
            <Menu className="h-5 w-5" />
          </button>
        </div>
      </nav>

      {/* Backdrop */}
      {drawerOpen && (
        <div
          className="fixed inset-0 z-[290] bg-slate-950/70 sm:hidden"
          onClick={closeDrawer}
        />
      )}

      {/* Slide-in drawer */}
      <div
        className={`fixed top-0 bottom-0 left-0 z-[300] w-[300px] overflow-y-auto transition-transform duration-300 ease-in-out sm:hidden ${
          drawerOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
        style={{
          background: 'rgba(15, 23, 42, 0.97)',
          backdropFilter: 'blur(16px)',
        }}
      >
        {/* Drawer header */}
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
            onClick={closeDrawer}
            className="flex h-8 w-8 items-center justify-center rounded-full text-slate-400 transition-colors hover:bg-white/10 hover:text-white"
            aria-label="Close menu"
          >
            <X className="h-4.5 w-4.5" />
          </button>
        </div>

        {/* Nav sections */}
        <div className="py-2">
          {navSections.map((section) => (
            <DrawerSection
              key={section.label}
              section={section}
              pathname={pathname}
              onClose={closeDrawer}
            />
          ))}
        </div>

        {/* Drawer footer */}
        <div className="border-t border-white/10 p-4">
          <p className="mb-2 truncate text-xs text-slate-500">{userEmail}</p>
          <button
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
