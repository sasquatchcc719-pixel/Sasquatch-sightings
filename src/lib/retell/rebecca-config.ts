export const REBECCA_RETELL_CONFIG = {
  bookingChannel: 'retell_rabecca',
  sourceLabel: 'Rabecca voice AI',
  actorLabel: 'Rabecca',
  adminHeading: 'Rabecca booked a job',
  estimateAdminHeading: 'Rabecca booked an estimate',
} as const

export function isRabeccaEnabled(): boolean {
  return process.env.REBECCA_VOICE_ENABLED !== 'false'
}
