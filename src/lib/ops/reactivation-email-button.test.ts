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
import {
  buildReactivationEmailHtml,
  clickedTooSoonAfterSend,
  isLikelyLinkScanner,
  reactivationBookingUrl,
} from '@/lib/ops/reactivation-campaign'

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

describe('reactivation click tracking', () => {
  it('points the button at the tracked link when the send has a token', () => {
    const html = buildReactivationEmailHtml(BODY, 'cust-1', 'tok-123')
    expect(html).toContain(
      'href="https://sightings.sasquatchcarpet.com/api/public/reactivation-click/tok-123"',
    )
    expect(html).not.toContain('href="https://www.sasquatchcarpet.com"')
  })

  it('lands the click on the website, tagged with the template', () => {
    const url = new URL(reactivationBookingUrl('standing_offer_twenty'))
    expect(url.origin).toBe('https://www.sasquatchcarpet.com')
    expect(url.searchParams.get('utm_source')).toBe('reactivation')
    expect(url.searchParams.get('utm_medium')).toBe('email')
    expect(url.searchParams.get('utm_campaign')).toBe('standing_offer_twenty')
  })

  it('flags mail scanners but not real phones and browsers', () => {
    expect(isLikelyLinkScanner(null)).toBe(true)
    expect(isLikelyLinkScanner('Mozilla/5.0 (compatible; Barracuda)')).toBe(
      true,
    )
    expect(isLikelyLinkScanner('python-requests/2.31')).toBe(true)
    expect(
      isLikelyLinkScanner(
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
      ),
    ).toBe(false)
    expect(
      isLikelyLinkScanner(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
      ),
    ).toBe(false)
  })

  it('treats a click seconds after delivery as a scanner', () => {
    const now = new Date('2026-09-26T16:00:00Z')
    expect(clickedTooSoonAfterSend('2026-09-26T15:59:30Z', now)).toBe(true)
    expect(clickedTooSoonAfterSend('2026-09-26T15:30:00Z', now)).toBe(false)
    expect(clickedTooSoonAfterSend(null, now)).toBe(false)
  })
})
