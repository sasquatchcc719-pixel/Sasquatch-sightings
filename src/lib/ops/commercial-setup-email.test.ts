import { describe, expect, it } from 'vitest'
import { buildCommercialSetupEmailDraft } from './commercial-setup-email'

describe('buildCommercialSetupEmailDraft', () => {
  it('requests payment and scope details without implying future commitment', () => {
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
    expect(draft.subject).toContain('appointments, services')
    expect(draft.body).toContain(
      'one place to see every confirmed cleaning appointment',
    )
    expect(draft.body).toContain('services planned for each visit')
    expect(draft.body).toContain(
      'enter the mobile number that should receive scheduling texts',
    )
    expect(draft.body).toContain('check the authorization box')
    expect(draft.body.indexOf('confirmed cleaning appointment')).toBeLessThan(
      draft.body.indexOf('payment and invoice instructions'),
    )
    expect(draft.body).toContain('This is not a contract')
    expect(draft.body).toContain('No signature is required')
    expect(draft.body).toContain('ACH is our preferred payment method')
    expect(draft.body).toContain('must pay by check or another method')
    expect(draft.body).toContain('Open Payment options')
    expect(draft.body).not.toContain('Routing number')
    expect(draft.body).not.toContain('Account number')
    expect(draft.body).toContain('Where invoices should be submitted')
    expect(draft.body).toContain('exact areas and cleaning services')
    expect(draft.body).toContain('Building access, service-window')
    expect(draft.body).toContain('Download our completed W-9')
    expect(draft.body).toContain('Use the Appointments tab')
    expect(draft.body).toContain('does not schedule anything automatically')
    expect(draft.body).toContain('commitment to future cleaning')
    expect(draft.body).not.toContain('please review and electronically sign')
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
