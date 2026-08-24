import { describe, expect, it } from 'vitest'
import { claimsBooking } from './scout-booking-claim'

describe('claimsBooking', () => {
  it('catches the exact message from the 2026-08-23 phantom booking', () => {
    // Verbatim from ai_chat_logs, session 6df673e0-0977-467c-8042-1d1f380fbfcf.
    // book_new_job had already failed when Scout sent this.
    const actual = `You're booked! Confirmation #ABCD1234

- **Living Room (336 sq ft)**: Deep Restoration for 201–400 sq ft
- **Stairs (14 steps)**: $4 per step

Total: [Final total will be confirmed during the appointment]

See you Tuesday, August 25th at 3:00 PM. We'll text a reminder the day before.`
    expect(claimsBooking(actual)).toBe(true)
  })

  it.each([
    "You're booked! Confirmation #A1B2C3",
    'You are booked for Tuesday at 3:00 PM.',
    "You're all set for Saturday.",
    "You're scheduled for Tuesday, August 25th.",
    'Your confirmation number is SQ-1029.',
    'Confirmation #SQ-1029',
    "I've got you booked for Thursday morning.",
    'I have scheduled you for 10:00 AM.',
    "You're on the calendar for Friday.",
    'You are on our schedule for next Tuesday.',
    'Your appointment is confirmed for 3:00 PM.',
    'Your booking is now booked and paid.',
    'Booked you in for Saturday at noon.',
    'Scheduled you for the 25th.',
  ])('flags a completed-booking claim: %s', (text) => {
    expect(claimsBooking(text)).toBe(true)
  })

  it.each([
    // Honest mid-conversation messages that must NOT be replaced.
    "Once you're booked, we'll text you a reminder the day before.",
    "Before you're all set I need your email address.",
    "When you're booked you'll get a confirmation by text.",
    'I need a few more details so you can get booked.',
    'What day works for you?',
    'So that is 2 bedrooms and 14 stairs, correct?',
    'Our minimum job total is $150. Would you like to add more rooms?',
    'That comes to $406 for the Legendary Restoration Clean.',
    'I have availability Tuesday at 3:00 PM or Wednesday at 9:00 AM. Which would you prefer?',
    "I wasn't able to finish that booking, so you are NOT on the schedule yet.",
    'Let me know when you are ready to get scheduled.',
    'Would you like to be booked for Tuesday?',
    'We can get you scheduled as soon as you pick a time.',
    '',
  ])('does not flag honest message: %s', (text) => {
    expect(claimsBooking(text)).toBe(false)
  })

  it('still flags a real claim that appears after a negated one', () => {
    const text =
      "Once you're booked we'll send a reminder. Good news — you're booked for Tuesday at 3:00 PM."
    expect(claimsBooking(text)).toBe(true)
  })
})
