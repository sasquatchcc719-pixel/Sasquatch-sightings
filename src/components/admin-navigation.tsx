'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Briefcase, Trophy, Users, ExternalLink, Phone, MessageSquare } from 'lucide-react'

export function AdminNavigation() {
  const pathname = usePathname()

  const tabs = [
    {
      name: 'Jobs',
      href: '/admin',
      icon: Briefcase,
      active: pathname === '/admin',
    },
    {
      name: 'Leads',
      href: '/admin/leads',
      icon: Phone,
      active: pathname === '/admin/leads',
    },
    {
      name: 'Contest',
      href: '/admin/sightings',
      icon: Trophy,
      active: pathname === '/admin/sightings',
    },
    {
      name: 'Partners',
      href: '/admin/partners',
      icon: Users,
      active: pathname === '/admin/partners',
    },
    {
      name: 'AI Chat',
      href: '/admin/conversations',
      icon: MessageSquare,
      active: pathname === '/admin/conversations',
    },
  ]

  return (
    <div className="border-b">
      <nav className="-mb-px flex flex-wrap items-center gap-4 sm:gap-6" aria-label="Tabs">
        {tabs.map((tab) => {
          const Icon = tab.icon
          return (
            <Link
              key={tab.name}
              href={tab.href}
              className={`
                flex items-center gap-2 border-b-2 px-1 py-3 text-sm font-medium transition-colors
                ${
                  tab.active
                    ? 'border-primary text-primary'
                    : 'border-transparent text-muted-foreground hover:border-border hover:text-foreground'
                }
              `}
            >
              <Icon className="h-4 w-4" />
              {tab.name}
            </Link>
          )
        })}
        
        {/* Quick link to public page */}
        <Link
          href="/preferred-partners"
          target="_blank"
          className="ml-auto flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          View Public Page
          <ExternalLink className="h-3 w-3" />
        </Link>
      </nav>
    </div>
  )
}
