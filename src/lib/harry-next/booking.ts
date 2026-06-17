/**
 * Harry (next) — booking intake state.
 *
 * Tracks what we know about a booking-in-progress and decides, deterministically,
 * what's still missing. Asking the customer for missing contact/schedule info is
 * low-risk and autonomous (no prices, recipient bound to the thread); only the
 * final booking action — the part with the total and the calendar — needs the
 * owner's approval. Code, not the model, decides when the booking is complete.
 */
import type { RequestedService } from './quote'

export type BookingFields = {
  firstName?: string
  lastName?: string
  email?: string
  street1?: string
  city?: string
  zipCode?: string
  leadSource?: string
  services: RequestedService[]
  preferredDate?: string
  preferredTime?: string
}

export const REQUIRED_BOOKING_FIELDS = [
  'firstName',
  'lastName',
  'email',
  'street1',
  'city',
  'zipCode',
  'leadSource',
  'services',
  'preferredDate',
  'preferredTime',
] as const

export type RequiredBookingField = (typeof REQUIRED_BOOKING_FIELDS)[number]

export function missingBookingFields(
  fields: BookingFields,
): RequiredBookingField[] {
  return REQUIRED_BOOKING_FIELDS.filter((field) => {
    if (field === 'services') return (fields.services?.length || 0) === 0
    const value = fields[field]
    return typeof value !== 'string' || value.trim().length === 0
  })
}

export function isBookingComplete(fields: BookingFields): boolean {
  return missingBookingFields(fields).length === 0
}

const CONTACT_FIELDS: RequiredBookingField[] = [
  'firstName',
  'lastName',
  'email',
  'street1',
  'city',
  'zipCode',
]

/**
 * The next message to send the customer to move the booking forward — asking for
 * whatever's missing, one logical group at a time. Never contains a price (the
 * model can't put numbers here either). Returns null when nothing is missing.
 */
export function nextBookingPrompt(fields: BookingFields): string | null {
  const missing = missingBookingFields(fields)
  if (missing.length === 0) return null

  if (missing.includes('services')) {
    return 'Happy to help! What would you like cleaned — rooms, stairs, anything else?'
  }

  const missingContact = CONTACT_FIELDS.filter((f) => missing.includes(f))
  if (missingContact.length > 0) {
    const wants: string[] = []
    if (missing.includes('firstName') || missing.includes('lastName')) {
      wants.push('your full name')
    }
    if (missing.includes('email')) wants.push('your email')
    if (
      missing.includes('street1') ||
      missing.includes('city') ||
      missing.includes('zipCode')
    ) {
      wants.push('the service address (street, city, and zip)')
    }
    return `Great — to get you set up, can I grab ${joinList(wants)}?`
  }

  if (missing.includes('preferredDate') || missing.includes('preferredTime')) {
    return 'What day and time work best for you?'
  }

  if (missing.includes('leadSource')) {
    return 'Last thing — how did you hear about us? (Google, Nextdoor, a referral, etc.)'
  }

  return 'Could you share a little more so I can finish setting this up?'
}

function joinList(items: string[]): string {
  if (items.length <= 1) return items[0] || ''
  if (items.length === 2) return `${items[0]} and ${items[1]}`
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`
}
