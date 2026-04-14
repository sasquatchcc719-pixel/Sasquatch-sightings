'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  CalendarDays,
  FilePlus2,
  Menu,
  Receipt,
  Settings,
  Users,
  Wrench,
  Repeat,
  FileText,
  MessageSquare,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

type NavItem = {
  href: string
  label: string
  description: string
  icon: React.ComponentType<{ className?: string }>
}

const NAV_ITEMS: NavItem[] = [
  {
    href: '/admin/operations',
    label: 'Schedule',
    description: 'Week, day, month, and blocked time',
    icon: CalendarDays,
  },
  {
    href: '/admin/operations/new-job',
    label: 'New Job',
    description: 'Full-screen standard job workflow',
    icon: FilePlus2,
  },
  {
    href: '/admin/operations/estimate',
    label: 'Estimate',
    description: 'Placeholder for future estimate flow',
    icon: FileText,
  },
  {
    href: '/admin/operations/recurring',
    label: 'Recurring Jobs',
    description: 'Manage recurring templates and schedules',
    icon: Repeat,
  },
  {
    href: '/admin/operations/customers',
    label: 'Customers',
    description: 'Returning customers and saved addresses',
    icon: Users,
  },
  {
    href: '/admin/operations/services',
    label: 'Services',
    description: 'Service catalog and price book controls',
    icon: Wrench,
  },
  {
    href: '/admin/operations/invoices',
    label: 'Invoices',
    description: 'Draft invoices and payment status',
    icon: Receipt,
  },
  {
    href: '/admin/operations/communications',
    label: 'Communications',
    description: 'Lifecycle SMS and email templates',
    icon: MessageSquare,
  },
  {
    href: '/admin/operations/settings',
    label: 'Settings',
    description: 'Queue, cron, and lifecycle messaging status',
    icon: Settings,
  },
]

function getSectionLabel(pathname: string): string {
  const exactMatch = NAV_ITEMS.find((item) => item.href === pathname)
  if (exactMatch) return exactMatch.label

  if (pathname.startsWith('/admin/operations/appointments/'))
    return 'Job Detail'
  if (pathname.startsWith('/admin/operations/invoices/'))
    return 'Invoice Detail'
  return 'Operations'
}

export function OperationsSubnav() {
  const pathname = usePathname()
  const sectionLabel = getSectionLabel(pathname)

  return (
    <div className="border-border/60 bg-card/80 flex flex-wrap items-center justify-between gap-3 rounded-2xl border p-4 shadow-sm backdrop-blur">
      <div className="flex items-center gap-3">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="gap-2">
              <Menu className="h-4 w-4" />
              Menu
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-80">
            <DropdownMenuLabel>Operations</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon
              const isActive =
                pathname === item.href ||
                (item.href !== '/admin/operations' &&
                  pathname.startsWith(`${item.href}/`))

              return (
                <DropdownMenuItem key={item.href} asChild>
                  <Link
                    href={item.href}
                    className={`flex items-start gap-3 ${isActive ? 'font-semibold' : ''}`}
                  >
                    <Icon className="mt-0.5 h-4 w-4" />
                    <div className="space-y-0.5">
                      <div>{item.label}</div>
                      <div className="text-muted-foreground text-xs">
                        {item.description}
                      </div>
                    </div>
                  </Link>
                </DropdownMenuItem>
              )
            })}
          </DropdownMenuContent>
        </DropdownMenu>

        <div>
          <p className="text-gradient text-xs font-semibold tracking-[0.25em] uppercase">
            Operations
          </p>
          <h1 className="text-2xl font-bold tracking-tight">{sectionLabel}</h1>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button asChild size="sm" className="gap-2">
          <Link href="/admin/operations/new-job">
            <FilePlus2 className="h-4 w-4" />
            New Job
          </Link>
        </Button>
        <Button asChild size="sm" variant="outline">
          <Link href="/admin/operations">Schedule</Link>
        </Button>
      </div>
    </div>
  )
}
