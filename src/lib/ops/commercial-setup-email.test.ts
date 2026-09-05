import { describe, expect, it } from 'vitest'
import { buildCommercialSetupEmailDraft } from './commercial-setup-email'

describe('buildCommercialSetupEmailDraft', () => {
  it('explains recurring approval, one-time service, and the customer steps', () => {
    const draft = buildCommercialSetupEmailDraft({
      businessName: 'Saltgrass Colorado Springs',
      contactName: 'Alex Manager',
      contactEmail: 'alex@example.com',
      agreementTitle: 'Initial Cleaning & Maintenance Options',
      agreementVersion: 2,
    })

    expect(draft.subject).toContain('Saltgrass Colorado Springs')
    expect(draft.body).toContain('Hi Alex,')
    expect(draft.body).toContain('alex@example.com')
    expect(draft.body).toContain(
      'Before we set up recurring service, please review and electronically sign',
    )
    expect(draft.body).toContain('monthly invoicing')
    expect(draft.body).toContain('only the approved one-time service')
    expect(draft.body).toContain('save your business details')
    expect(draft.body).toContain('not yet a recurring commitment')
    expect(draft.body).toContain('Use the Appointments tab')
    expect(draft.body).toContain('does not schedule anything automatically')
  })
  it.each(['New Estimate', 'Saltgrass Colorado Springs'])(
    'does not greet a placeholder name (%s)',
    (contactName) => {
      expect(
        buildCommercialSetupEmailDraft({
          businessName: 'Saltgrass Colorado Springs',
          contactName,
          contactEmail: 'test@example.com',
          agreementTitle: 'Terms',
          agreementVersion: 1,
        }).body,
      ).toMatch(/^Hello,/)
    },
  )
})
