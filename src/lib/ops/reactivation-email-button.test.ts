// @vitest-environment node
/**
 * Charles, looking at the admin preview: "it says over and over again to use
 * the button below to book online, but I don't think there's an actual button."
 *
 * The button was there in the real send all along — the preview rendered these
 * through the generic ops wrapper, which has none. This pins the button to the
 * copy that promises it, so neither can drift again.
 */
import { describe, it, expect } from 'vitest'
import { buildReactivationEmailHtml } from '@/lib/ops/reactivation-campaign'

// Verbatim body from a real send (template local_trust_owner_led).
const BODY = [
  'Hey Kip,',
  'Quick Sasquatch reminder: we do more than carpet.',
  'Past customer offer: $20 off your next cleaning.',
  'Use the button below to book online.',
  'Thanks,\nCharles\nSasquatch Carpet Cleaning',
].join('\n\n')

describe('the reactivation email', () => {
  const html = buildReactivationEmailHtml(BODY, 'cust-1')

  it('actually contains the button the copy promises', () => {
    expect(html).toContain('BOOK ONLINE')
    expect(html).toContain('href="https://www.sasquatchcarpet.com"')
  })

  it('puts the button after the body, so "below" is true', () => {
    expect(html.indexOf('button below')).toBeLessThan(
      html.indexOf('BOOK ONLINE'),
    )
  })

  it('still carries an unsubscribe link', () => {
    expect(html.toLowerCase()).toContain('unsubscribe')
  })

  it('renders the body as paragraphs rather than one run-on block', () => {
    expect(
      (html.match(/<p style="margin:0 0 16px 0/g) ?? []).length,
    ).toBeGreaterThan(3)
  })
})
