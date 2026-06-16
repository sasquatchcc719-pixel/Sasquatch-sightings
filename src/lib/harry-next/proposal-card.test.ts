import { describe, expect, it } from 'vitest'
import { buildApprovalCard } from './proposal-card'

describe('buildApprovalCard', () => {
  it('shows recipient, action, and the exact reply — and asks for approval', () => {
    const card = buildApprovalCard({
      customerName: 'Jamie Jones',
      recipientPhone: '+17065367349',
      actionSummary: 'Remove "Hall/Bathroom/Closet" — new total $353.00',
      proposedReply:
        "Got it, Jamie! I've removed the closet. Your updated total is $353.00.",
    })

    // WHO: the bound recipient is visible and unambiguous.
    expect(card).toContain('Jamie Jones')
    expect(card).toContain('+17065367349')
    // WHAT: the action and the real total.
    expect(card).toContain('new total $353.00')
    // The exact message that will go out.
    expect(card).toContain("Got it, Jamie! I've removed the closet")
    // Approval is required.
    expect(card).toMatch(/approve/i)
    expect(card).toMatch(/reject/i)
  })

  it('falls back gracefully when the name is unknown', () => {
    const card = buildApprovalCard({
      customerName: null,
      recipientPhone: '+17190001111',
      actionSummary: 'Remove "Dryer Duct cleaning" — new total $298.00',
      proposedReply: 'Done — your updated total is $298.00.',
    })
    expect(card).toContain('this customer')
    expect(card).toContain('+17190001111')
  })
})
