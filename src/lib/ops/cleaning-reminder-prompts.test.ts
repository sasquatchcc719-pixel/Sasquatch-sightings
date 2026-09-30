import { describe, expect, it } from 'vitest'
import {
  buildCleaningReminderDeclinedMessage,
  buildCleaningReminderPromptMessage,
  cleaningReminderPromptReviewWait,
  cleaningReminderPromptTime,
  parseCleaningReminderPromptReply,
} from './cleaning-reminder-prompts'
import {
  buildConfirmationMessage,
  buildReminderMessage,
} from './cleaning-reminders'

describe('cleaning reminder prompt timing', () => {
  it('waits 30 minutes after its anchor event', () => {
    expect(
      cleaningReminderPromptTime('2026-09-30T16:00:00Z').toISOString(),
    ).toBe('2026-09-30T16:30:00.000Z')
  })

  it('waits 30 minutes from the actual review send', () => {
    const now = new Date('2026-09-30T16:10:00Z')
    expect(
      cleaningReminderPromptReviewWait(
        { status: 'sent', sent_at: '2026-09-30T16:00:00Z' },
        now,
      )?.toISOString(),
    ).toBe('2026-09-30T16:30:00.000Z')
  })

  it('keeps waiting while a review request is pending', () => {
    const now = new Date('2026-09-30T16:10:00Z')
    expect(
      cleaningReminderPromptReviewWait(
        { status: 'pending', sent_at: null },
        now,
      )?.toISOString(),
    ).toBe('2026-09-30T16:15:00.000Z')
  })

  it('does not add delay when the review was skipped', () => {
    expect(
      cleaningReminderPromptReviewWait(
        { status: 'skipped', sent_at: null },
        new Date('2026-09-30T16:10:00Z'),
      ),
    ).toBeNull()
  })
})

describe('cleaning reminder prompt copy', () => {
  it('makes the choice optional and explains that no booking is created', () => {
    const message = buildCleaningReminderPromptMessage({
      first_name: 'Jane',
      full_name: 'Jane Customer',
    })

    expect(message).toContain('Hi Jane')
    expect(message).toMatch(/no appointment will be booked/i)
    expect(message).toMatch(/no obligation to schedule/i)
    expect(message).toMatch(/Reply 3, 6, or 12/i)
    expect(message).toMatch(/NO THANKS/i)
  })

  it('confirms a decline without starting another conversation', () => {
    expect(buildCleaningReminderDeclinedMessage()).toMatch(
      /no cleaning reminder has been set/i,
    )
  })
})

describe('cleaning reminder reply parsing', () => {
  it.each([
    ['3', 3],
    ['three months', 3],
    ['6 months please', 6],
    ['six months', 6],
    ['12', 12],
    ['1 year', 12],
  ])('parses exact interval reply %s', (reply, months) => {
    expect(parseCleaningReminderPromptReply(reply)).toEqual(
      months ? { kind: 'interval', months } : null,
    )
  })

  it.each(['NO THANKS', 'No reminder.', "don't remind me"])(
    'recognizes an exact decline: %s',
    (reply) => {
      expect(parseCleaningReminderPromptReply(reply)).toEqual({
        kind: 'decline',
      })
    },
  )

  it('does not hijack normal customer messages', () => {
    expect(
      parseCleaningReminderPromptReply('Can we do next Thursday?'),
    ).toBeNull()
    expect(
      parseCleaningReminderPromptReply('The carpet still has a spot'),
    ).toBeNull()
  })
})

describe('cleaning reminder messages', () => {
  const customer = { first_name: 'Jane', full_name: 'Jane Customer' }

  it('states that the immediate confirmation is not a booking', () => {
    const message = buildConfirmationMessage(
      customer,
      12,
      new Date('2027-09-30T16:00:00Z'),
    )
    expect(message).toMatch(/nothing has been booked/i)
    expect(message).toMatch(/no obligation to schedule/i)
  })

  it('keeps the future message informational and no-pressure', () => {
    const message = buildReminderMessage(
      customer,
      12,
      new Date('2026-09-30T16:00:00Z'),
    )
    expect(message).toMatch(/nothing has been booked/i)
    expect(message).toMatch(/no obligation to schedule/i)
    expect(message).not.toMatch(/REMIND20|\$20 off/i)
  })
})
