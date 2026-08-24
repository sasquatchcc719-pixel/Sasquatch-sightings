export type TelegramChannel = {
  href: string
  name: string
  when: string
}

export const LEFTOVER_CHANNELS = [
  { id: 'radar', name: 'Radar Daily', when: 'Midnight' },
  { id: 'reviews', name: 'Reviews', when: '6:10am' },
  { id: 'coverage', name: 'Coverage', when: 'Mon 8:00am' },
  { id: 'briefing', name: 'Briefing', when: 'Mon 9:30am' },
  { id: 'grid', name: 'Grid', when: 'When due' },
  { id: 'sweep', name: 'Index sweep', when: 'Thu 10:00am' },
  { id: 'opportunities', name: 'Close calls', when: '1st of month' },
  { id: 'truck', name: 'Truck', when: 'When low / due' },
  { id: 'alerts', name: 'Alerts', when: 'As they happen' },
] as const

export const TELEGRAM_CHANNELS: TelegramChannel[] = [
  { href: '/admin/telegram', name: 'Rankings', when: 'Monday push' },
  ...LEFTOVER_CHANNELS.map((channel) => ({
    href: `/admin/telegram?view=${channel.id}#leftover-reports`,
    name: channel.name,
    when: channel.when,
  })),
]
