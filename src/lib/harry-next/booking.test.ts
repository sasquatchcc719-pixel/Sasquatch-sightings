import { describe, expect, it } from 'vitest'
import {
  isBookingComplete,
  missingBookingFields,
  nextBookingPrompt,
  type BookingFields,
} from './booking'

function partial(overrides: Partial<BookingFields> = {}): BookingFields {
  return { services: [], ...overrides }
}

const complete: BookingFields = {
  firstName: 'Jamie',
  lastName: 'Jones',
  email: 'jamie@example.com',
  street1: '19992 Royal Troon Dr',
  city: 'Monument',
  zipCode: '80132',
  leadSource: 'Nextdoor',
  services: [{ description: 'bedroom', quantity: 2 }],
  preferredDate: '2026-06-18',
  preferredTime: '10:00',
}

describe('missingBookingFields', () => {
  it('lists every required field when nothing is known', () => {
    expect(missingBookingFields(partial())).toContain('email')
    expect(missingBookingFields(partial())).toContain('services')
    expect(isBookingComplete(partial())).toBe(false)
  })

  it('reports complete only when all required fields are present', () => {
    expect(missingBookingFields(complete)).toEqual([])
    expect(isBookingComplete(complete)).toBe(true)
  })

  it('treats an empty services list as missing', () => {
    expect(missingBookingFields({ ...complete, services: [] })).toEqual([
      'services',
    ])
  })
})

describe('nextBookingPrompt', () => {
  it('asks for services first when none are given', () => {
    expect(nextBookingPrompt(partial())).toMatch(/cleaned/i)
  })

  it('asks for the missing contact info and never includes a price', () => {
    const prompt = nextBookingPrompt(
      partial({ services: [{ description: 'bedroom', quantity: 2 }] }),
    )
    expect(prompt).toMatch(/name|email|address/i)
    expect(prompt).not.toMatch(/\$\d/)
  })

  it('asks for the schedule once contact info is known', () => {
    const prompt = nextBookingPrompt({
      ...complete,
      preferredDate: undefined,
      preferredTime: undefined,
    })
    expect(prompt).toMatch(/day and time/i)
  })

  it('returns null when the booking is complete', () => {
    expect(nextBookingPrompt(complete)).toBeNull()
  })
})
