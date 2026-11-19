export const NAVIGATION_SECTION_IDS = [
  'operations',
  'marketing',
  'comms',
  'ai',
  'preview',
] as const

export type NavigationSectionId = (typeof NAVIGATION_SECTION_IDS)[number]

export const NAVIGATION_SECTIONS: Record<
  NavigationSectionId,
  { label: string; icon: NavigationIconName }
> = {
  operations: { label: 'Operations', icon: 'truck' },
  marketing: { label: 'Marketing', icon: 'megaphone' },
  comms: { label: 'Comms', icon: 'phone' },
  ai: { label: 'AI', icon: 'bot' },
  preview: { label: 'Preview', icon: 'eye' },
}

export type NavigationIconName =
  | 'award'
  | 'ban'
  | 'bar-chart'
  | 'bot'
  | 'briefcase'
  | 'calendar'
  | 'credit-card'
  | 'eye'
  | 'flask'
  | 'fuel'
  | 'link'
  | 'mail'
  | 'map'
  | 'map-pin'
  | 'megaphone'
  | 'message-square'
  | 'phone'
  | 'phone-call'
  | 'search'
  | 'send'
  | 'shield-alert'
  | 'shield-check'
  | 'store'
  | 'tag'
  | 'target'
  | 'trophy'
  | 'truck'
  | 'user-search'
  | 'users'

export type NavigationItem = {
  id: string
  name: string
  desktopName?: string
  shortName?: string
  href: string
  description: string
  icon: NavigationIconName
  homeSection: NavigationSectionId
  external?: boolean
  active?:
    | 'exact'
    | 'prefix'
    | 'schedule'
    | 'comms'
    | 'phone-texts'
    | 'ai-chats'
}

export const NAVIGATION_ITEMS: NavigationItem[] = [
  {
    id: 'tomorrow-fill',
    name: 'Tomorrow Fill',
    href: '/admin/operations/tomorrow-fill',
    description: 'Fill tomorrow’s route gaps',
    icon: 'send',
    homeSection: 'operations',
  },
  {
    id: 'commercial',
    name: 'Commercial Accounts',
    shortName: 'Commercial',
    href: '/admin/operations/commercial',
    description: 'Business agreements, signatures, and service plans',
    icon: 'briefcase',
    homeSection: 'operations',
    active: 'prefix',
  },
  {
    id: 'schedule',
    name: 'Schedule',
    desktopName: 'Operations',
    href: '/admin/operations',
    description: 'Calendar, bookings, invoices, and sync queue',
    icon: 'calendar',
    homeSection: 'operations',
    active: 'schedule',
  },
  {
    id: 'customers',
    name: 'Customers',
    href: '/admin/operations/customers',
    description: 'Customer directory and job history',
    icon: 'users',
    homeSection: 'operations',
    active: 'prefix',
  },
  {
    id: 'receipts',
    name: 'Receipt Records',
    shortName: 'Receipts',
    href: '/admin/operations/receipts',
    description: 'Gas and expense receipts sent to QuickBooks',
    icon: 'fuel',
    homeSection: 'operations',
  },
  {
    id: 'service-concerns',
    name: 'Service Concerns',
    href: '/admin/operations/service-concerns',
    description: 'Review evidence before approving a warranty return',
    icon: 'shield-check',
    homeSection: 'operations',
    active: 'prefix',
  },
  {
    id: 'toolbox',
    name: 'Toolbox',
    href: '/field',
    description: 'Canvassing, Brain, inventory, and Gears quick actions',
    icon: 'briefcase',
    homeSection: 'operations',
    active: 'prefix',
  },
  {
    id: 'jobs',
    name: 'Jobs',
    href: '/admin/jobs',
    description: 'Manage completed jobs',
    icon: 'briefcase',
    homeSection: 'operations',
  },
  {
    id: 'stats',
    name: 'Stats',
    href: '/admin/stats',
    description: 'Revenue and utilization tracking',
    icon: 'bar-chart',
    homeSection: 'operations',
    active: 'prefix',
  },
  {
    id: 'chemicals',
    name: 'Chemicals',
    href: '/admin/chemicals',
    description: 'Truck chemical inventory and AI assistant specs',
    icon: 'flask',
    homeSection: 'operations',
  },
  {
    id: 'fleet',
    name: 'Fleet',
    href: '/admin/fleet',
    description: 'Vehicles, tracking, meters, and maintenance',
    icon: 'truck',
    homeSection: 'operations',
    active: 'prefix',
  },
  {
    id: 'radar',
    name: 'Radar',
    href: '/admin/marketing/radar',
    description: 'Local rank tracking and competitor results',
    icon: 'target',
    homeSection: 'marketing',
  },
  {
    id: 'search-rankings',
    name: 'Search Rankings',
    href: '/admin/marketing/search-rankings',
    description: 'Google keywords tracked in the weekly report',
    icon: 'search',
    homeSection: 'marketing',
  },
  {
    id: 'business-decisions',
    name: 'Business Decisions',
    shortName: 'Decisions',
    href: '/admin/marketing/rollup',
    description: 'Decisions, invoiced work, and recorded lead sources',
    icon: 'bar-chart',
    homeSection: 'marketing',
  },
  {
    id: 'google-lsa',
    name: 'Google LSA',
    href: '/admin/marketing/lsa',
    description: 'LSA charges, conversations, and booked work',
    icon: 'bar-chart',
    homeSection: 'marketing',
  },
  {
    id: 'ad-performance',
    name: 'Ad Performance',
    href: '/admin/marketing',
    description: 'Lead-source earnings after ad spend and labor',
    icon: 'bar-chart',
    homeSection: 'marketing',
  },
  {
    id: 'canvassing',
    name: 'Canvassing',
    href: '/admin/canvass',
    description: 'Door-hanger walk coverage and session audit',
    icon: 'map',
    homeSection: 'marketing',
  },
  {
    id: 'card-analytics',
    name: 'Card Analytics',
    href: '/admin/tap-analytics',
    description: 'Business-card taps, clicks, and conversions',
    icon: 'bar-chart',
    homeSection: 'marketing',
  },
  {
    id: 'all-leads',
    name: 'All Leads',
    href: '/admin/leads',
    description: 'Lead pipeline and follow-ups',
    icon: 'phone',
    homeSection: 'marketing',
  },
  {
    id: 'contest-admin',
    name: 'Contest',
    href: '/admin/sightings',
    description: 'Sightings and contest entries',
    icon: 'trophy',
    homeSection: 'marketing',
  },
  {
    id: 'vendors',
    name: 'Vendors',
    href: '/admin/vendors',
    description: 'Vendor locations and station health',
    icon: 'store',
    homeSection: 'marketing',
  },
  {
    id: 'partners',
    name: 'Partners',
    href: '/admin/partners',
    description: 'Referral partners',
    icon: 'users',
    homeSection: 'marketing',
  },
  {
    id: 'push',
    name: 'Push',
    href: '/admin/push',
    description: 'Send push notifications',
    icon: 'megaphone',
    homeSection: 'marketing',
  },
  {
    id: 'social-posts',
    name: 'Social Posts',
    href: '/admin/social-posts',
    description: 'Google job posts, offers, and campaigns',
    icon: 'eye',
    homeSection: 'marketing',
  },
  {
    id: 'promo-codes',
    name: 'Promo Codes',
    href: '/admin/promo-codes',
    description: 'Create, expire, and track discount codes',
    icon: 'tag',
    homeSection: 'marketing',
  },
  {
    id: 'phone',
    name: 'Phone',
    href: '/admin/phone',
    description: 'Make outbound calls from the browser',
    icon: 'phone',
    homeSection: 'comms',
  },
  {
    id: 'call-log',
    name: 'Call Log',
    href: '/admin/call-logs',
    description: 'Answered, voicemail, and missed calls',
    icon: 'phone-call',
    homeSection: 'comms',
    active: 'prefix',
  },
  {
    id: 'direct-texts',
    name: 'Direct Texts',
    href: '/admin/conversations?source=phone',
    description: 'Texts from people who contacted the business number',
    icon: 'message-square',
    homeSection: 'comms',
    active: 'phone-texts',
  },
  {
    id: 'all-conversations',
    name: 'All Conversations',
    shortName: 'Conversations',
    href: '/admin/conversations',
    description: 'All SMS threads',
    icon: 'message-square',
    homeSection: 'comms',
    active: 'prefix',
  },
  {
    id: 'comms-home',
    name: 'Comms Home',
    shortName: 'Comms',
    href: '/admin/comms',
    description: 'Communication shortcuts and unread messages',
    icon: 'message-square',
    homeSection: 'comms',
    active: 'comms',
  },
  {
    id: 'sms-outbox',
    name: 'SMS Outbox',
    href: '/admin/sms-outbox',
    description: 'Outbound Operations texts',
    icon: 'message-square',
    homeSection: 'comms',
  },
  {
    id: 'telegram',
    name: 'Telegram',
    href: '/admin/telegram',
    description: 'Search reports, keywords, and weekly alerts',
    icon: 'send',
    homeSection: 'comms',
    active: 'prefix',
  },
  {
    id: 'email-outbox',
    name: 'Email Outbox',
    href: '/admin/email-outbox',
    description: 'Emails sent to customers',
    icon: 'mail',
    homeSection: 'comms',
  },
  {
    id: 'voicemails',
    name: 'Voicemails',
    href: '/admin/voicemails',
    description: 'Voicemail recordings',
    icon: 'phone',
    homeSection: 'comms',
  },
  {
    id: 'templates-drip',
    name: 'Templates & Drip',
    href: '/admin/operations/communications',
    description: 'Lifecycle templates and drip campaigns',
    icon: 'mail',
    homeSection: 'comms',
  },
  {
    id: 'phone-settings',
    name: 'Phone Settings',
    shortName: 'Settings',
    href: '/admin/phone-settings',
    description: 'Voicemail, hours, and routing',
    icon: 'phone',
    homeSection: 'comms',
  },
  {
    id: 'blacklist',
    name: 'Blacklist',
    href: '/admin/blacklist',
    description: 'Block customers from calling or booking',
    icon: 'ban',
    homeSection: 'comms',
  },
  {
    id: 'scout-logs',
    name: 'Scout Logs',
    href: '/admin/scout/logs',
    description: 'Website chat transcripts, tools, and bookings',
    icon: 'bot',
    homeSection: 'ai',
    active: 'prefix',
  },
  {
    id: 'ranger-hiring',
    name: 'Ranger Hiring',
    href: '/admin/ranger',
    description: 'Hiring pipeline, candidate reports, and approvals',
    icon: 'user-search',
    homeSection: 'ai',
  },
  {
    id: 'phone-assistant-calls',
    name: 'After-hours Calls',
    href: '/admin/phone-assistant',
    description: 'Phone assistant transcripts and call summaries',
    icon: 'phone-call',
    homeSection: 'ai',
  },
  {
    id: 'ai-chats',
    name: 'AI Chats',
    href: '/admin/conversations?source=ai_chats',
    description: 'AI-initiated chats',
    icon: 'message-square',
    homeSection: 'ai',
    active: 'ai-chats',
  },
  {
    id: 'brain-logs',
    name: 'Brain Logs',
    href: '/admin/foreman-logs',
    description: 'Field AI stain and fiber diagnoses',
    icon: 'flask',
    homeSection: 'ai',
  },
  {
    id: 'fiber-checks',
    name: 'Fiber Checks',
    href: '/admin/fiber-checks',
    description: 'Rugs and upholstery identified before cleaning',
    icon: 'shield-alert',
    homeSection: 'ai',
  },
  {
    id: 'business-card',
    name: 'Business Card',
    href: '/tap',
    description: 'NFC card landing page',
    icon: 'credit-card',
    homeSection: 'preview',
    external: true,
  },
  {
    id: 'contest-page',
    name: 'Contest Page',
    href: '/sightings',
    description: 'Public sightings contest',
    icon: 'trophy',
    homeSection: 'preview',
    external: true,
  },
  {
    id: 'review-share',
    name: 'Review & Share',
    href: '/links',
    description: 'Post-service follow-up page',
    icon: 'link',
    homeSection: 'preview',
    external: true,
  },
  {
    id: 'sightings-map',
    name: 'Sightings Map',
    href: '/',
    description: 'Public map of sightings',
    icon: 'map',
    homeSection: 'preview',
    external: true,
  },
  {
    id: 'vendor-landing',
    name: 'Vendor Landing',
    href: '/location/demo',
    description: 'Customer-facing vendor page',
    icon: 'map-pin',
    homeSection: 'preview',
    external: true,
  },
  {
    id: 'vendor-contest',
    name: 'Vendor Contest',
    href: '/location/demo/contest',
    description: 'Vendor-specific contest page',
    icon: 'trophy',
    homeSection: 'preview',
    external: true,
  },
  {
    id: 'partner-signup',
    name: 'Partner Signup',
    href: '/partners/register',
    description: 'Referral partner registration',
    icon: 'users',
    homeSection: 'preview',
    external: true,
  },
  {
    id: 'preferred-partners',
    name: 'Preferred Partners',
    href: '/preferred-partners',
    description: 'Public partner directory',
    icon: 'award',
    homeSection: 'preview',
    external: true,
  },
]

export const NAVIGATION_ITEM_BY_ID = Object.fromEntries(
  NAVIGATION_ITEMS.map((item) => [item.id, item]),
) as Record<string, NavigationItem>

export type NavigationSurfaceLayout = {
  sectionOrder: NavigationSectionId[]
  sections: Record<NavigationSectionId, string[]>
  hidden: string[]
}

export type NavigationPreferences = {
  desktop: NavigationSurfaceLayout & {
    shortcuts: string[]
    shortcutAfter: NavigationSectionId | 'start' | 'end'
  }
  mobile: NavigationSurfaceLayout & { bottom: string[] }
}

function allItemsByHomeSection(): Record<NavigationSectionId, string[]> {
  return Object.fromEntries(
    NAVIGATION_SECTION_IDS.map((section) => [
      section,
      NAVIGATION_ITEMS.filter((item) => item.homeSection === section).map(
        (item) => item.id,
      ),
    ]),
  ) as Record<NavigationSectionId, string[]>
}

const defaultSections = allItemsByHomeSection()

export const DEFAULT_NAVIGATION_PREFERENCES: NavigationPreferences = {
  desktop: {
    sectionOrder: [...NAVIGATION_SECTION_IDS],
    sections: defaultSections,
    hidden: ['tomorrow-fill', 'customers', 'all-conversations', 'comms-home'],
    shortcuts: ['call-log'],
    shortcutAfter: 'comms',
  },
  mobile: {
    sectionOrder: [...NAVIGATION_SECTION_IDS],
    sections: allItemsByHomeSection(),
    hidden: [
      'customers',
      'chemicals',
      'search-rankings',
      'google-lsa',
      'ad-performance',
      'comms-home',
      'blacklist',
      'brain-logs',
      'fiber-checks',
      'vendor-contest',
    ],
    bottom: ['schedule', 'comms-home', 'customers', 'stats'],
  },
}

function stringArray(value: unknown, allowed: Set<string>): string[] {
  if (!Array.isArray(value)) return []
  return [
    ...new Set(
      value.filter(
        (item): item is string => typeof item === 'string' && allowed.has(item),
      ),
    ),
  ]
}

function normalizeSurface(
  value: unknown,
  extras: { key: 'shortcuts' | 'bottom'; limit: number },
) {
  const source = value && typeof value === 'object' ? value : {}
  const record = source as Record<string, unknown>
  const validItems = new Set(NAVIGATION_ITEMS.map((item) => item.id))
  const validSections = new Set<string>(NAVIGATION_SECTION_IDS)
  const sectionOrder = stringArray(
    record.sectionOrder,
    validSections,
  ) as NavigationSectionId[]
  for (const section of NAVIGATION_SECTION_IDS) {
    if (!sectionOrder.includes(section)) sectionOrder.push(section)
  }

  const rawSections =
    record.sections && typeof record.sections === 'object'
      ? (record.sections as Record<string, unknown>)
      : {}
  const seen = new Set<string>()
  const sections = Object.fromEntries(
    NAVIGATION_SECTION_IDS.map((section) => {
      const items = stringArray(rawSections[section], validItems).filter(
        (id) => {
          if (seen.has(id)) return false
          seen.add(id)
          return true
        },
      )
      return [section, items]
    }),
  ) as Record<NavigationSectionId, string[]>

  for (const item of NAVIGATION_ITEMS) {
    if (!seen.has(item.id)) sections[item.homeSection].push(item.id)
  }

  return {
    sectionOrder,
    sections,
    hidden: stringArray(record.hidden, validItems),
    [extras.key]: stringArray(record[extras.key], validItems).slice(
      0,
      extras.limit,
    ),
  }
}

export function normalizeNavigationPreferences(
  value: unknown,
): NavigationPreferences {
  const source = value && typeof value === 'object' ? value : {}
  const record = source as Record<string, unknown>
  const desktopSource =
    record.desktop && typeof record.desktop === 'object'
      ? (record.desktop as Record<string, unknown>)
      : {}
  const shortcutAfter =
    desktopSource.shortcutAfter === 'start' ||
    desktopSource.shortcutAfter === 'end' ||
    NAVIGATION_SECTION_IDS.includes(
      desktopSource.shortcutAfter as NavigationSectionId,
    )
      ? (desktopSource.shortcutAfter as NavigationSectionId | 'start' | 'end')
      : 'comms'
  return {
    desktop: {
      ...normalizeSurface(record.desktop, {
        key: 'shortcuts',
        limit: 5,
      }),
      shortcutAfter,
    } as NavigationPreferences['desktop'],
    mobile: normalizeSurface(record.mobile, {
      key: 'bottom',
      limit: 4,
    }) as NavigationPreferences['mobile'],
  }
}

export function cloneNavigationPreferences(
  preferences: NavigationPreferences,
): NavigationPreferences {
  return JSON.parse(JSON.stringify(preferences)) as NavigationPreferences
}

export function isNavigationItemActive(
  item: NavigationItem,
  pathname: string,
  searchParams?: Pick<URLSearchParams, 'get'>,
): boolean {
  if (item.active === 'schedule') {
    return (
      pathname.startsWith('/admin/operations') &&
      !pathname.startsWith('/admin/operations/customers')
    )
  }
  if (item.active === 'phone-texts') {
    return (
      pathname === '/admin/conversations' &&
      searchParams?.get('source') === 'phone'
    )
  }
  if (item.active === 'comms') {
    return (
      pathname.startsWith('/admin/comms') ||
      pathname.startsWith('/admin/conversations')
    )
  }
  if (item.active === 'ai-chats') {
    return (
      pathname === '/admin/conversations' &&
      searchParams?.get('source') === 'ai_chats'
    )
  }
  if (item.active === 'prefix') {
    return pathname === item.href || pathname.startsWith(`${item.href}/`)
  }
  return pathname === item.href
}
