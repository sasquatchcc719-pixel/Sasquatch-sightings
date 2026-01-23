'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Phone, BarChart3 } from 'lucide-react'

export function DashboardNavigation() {
  const pathname = usePathname()

  const tabs = [
    {
      name: 'Leads',
      href: '/dashboard/leads',
      icon: Phone,
      active: pathname === '/dashboard/leads',
    },
    // Future: Analytics, Reports, etc.
    // {
    //   name: 'Analytics',
    //   href: '/dashboard/analytics',
    //   icon: BarChart3,
    //   active: pathname === '/dashboard/analytics',
    // },
  ]

  return (
    <div className="border-t bg-muted/30">
      <nav className="flex gap-1 px-4 overflow-x-auto" aria-label="Dashboard Tabs">
        {tabs.map((tab) => {
          const Icon = tab.icon
          return (
            <Link
              key={tab.name}
              href={tab.href}
              className={`
                flex items-center gap-2 px-4 py-2.5 text-sm font-medium whitespace-nowrap
                ${
                  tab.active
                    ? 'border-b-2 border-primary text-primary'
                    : 'text-muted-foreground hover:text-foreground'
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
