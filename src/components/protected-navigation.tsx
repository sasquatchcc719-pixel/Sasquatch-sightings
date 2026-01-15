'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Briefcase, Trophy } from 'lucide-react'

export function ProtectedNavigation() {
  const pathname = usePathname()

  const tabs = [
    {
      name: 'Jobs',
      href: '/protected',
      icon: Briefcase,
      active: pathname === '/protected',
    },
    {
      name: 'Contest Entries',
      href: '/protected/sightings',
      icon: Trophy,
      active: pathname === '/protected/sightings',
    },
  ]

  return (
    <div className="border-b">
      <nav className="-mb-px flex gap-6" aria-label="Tabs">
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
      </nav>
    </div>
  )
}
