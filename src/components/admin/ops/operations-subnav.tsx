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
  ShieldBan,
  Clock,
  DollarSign,
  MapPin,
  Timer,
  Footprints,
  Fuel,
  ShieldCheck,
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
    href: '/admin/operations/commercial',
    label: 'Commercial Accounts',
    description: 'Business profiles, agreements, signatures, and service plans',
    icon: FileText,
  },
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
    href: '/admin/operations?action=block',
    label: 'Block Time',
    description: 'Block vacation, sick days, or any time off',
    icon: ShieldBan,
  },
  {
    href: '/admin/operations?action=hours',
    label: 'Business Hours',
    description: 'Edit weekly business hours',
    icon: Clock,
  },
  {
    href: '/admin/operations/estimates',
    label: 'Estimates',
    description: 'Measuring visits, quotes, and conversions to jobs',
    icon: FileText,
  },
  {
    href: '/admin/operations/queue',
    label: 'Work Queue',
    description: 'Approved estimates and maintenance awaiting a slot',
    icon: Wrench,
  },
  {
    href: '/admin/operations/service-concerns',
    label: 'Service Concerns',
    description: 'Assess customer evidence before approving a return visit',
    icon: ShieldCheck,
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
  {
    href: '/admin/operations/dispatch',
    label: 'Live Dispatch',
    description: 'Real-time map of clocked-in technicians',
    icon: MapPin,
  },
  {
    href: '/admin/operations/timesheets',
    label: 'GPS Activity',
    description: 'Location history and travel vs on-site review',
    icon: Timer,
  },
  {
    href: '/admin/operations/payroll-timesheets',
    label: 'Payroll Timesheets',
    description: 'Manual payable time entries and daily totals',
    icon: DollarSign,
  },
  {
    href: '/admin/operations/receipts',
    label: 'Tech Receipts',
    description: 'Field gas & expense receipts forwarded to QuickBooks',
    icon: Fuel,
  },
  {
    href: '/admin/operations/my-day',
    label: 'My Day',
    description: 'Personal GPS shift summary for today',
    icon: Footprints,
  },
]

function getSectionLabel(pathname: string): string {
  if (pathname.startsWith('/admin/operations/commercial/'))
    return 'Commercial Account'
  const exactMatch = NAV_ITEMS.find((item) => item.href === pathname)
  if (exactMatch) return exactMatch.label

  if (pathname.startsWith('/admin/operations/appointments/'))
    return 'Job Detail'
  if (pathname.startsWith('/admin/operations/invoices/'))
    return 'Invoice Detail'
  if (pathname.startsWith('/admin/operations/estimates/')) return 'Estimate'
  if (pathname.startsWith('/admin/operations/recurring/visit/'))
    return 'Recurring Visit'
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
    </div>
  )
}
