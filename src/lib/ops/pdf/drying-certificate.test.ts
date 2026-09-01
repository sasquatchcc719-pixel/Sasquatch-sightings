// @vitest-environment node
/**
 * The certificate is the one document that states a conclusion, so what it is
 * allowed to conclude is pinned here — both the arithmetic and the wording.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import {
  buildDryingCertificate,
  dryingGoalFor,
} from '@/lib/ops/pdf/drying-certificate-data'
import { DRY_WITHIN, moistureBand } from '@/lib/ops/restoration-moisture'
import type { DryingReportData } from '@/lib/ops/pdf/drying-report'

function base(overrides: Partial<DryingReportData> = {}): DryingReportData {
  return {
    company: {
      name: 'Sasquatch Carpet Cleaning',
      phone: '(719) 249-8791',
      email: 'sasquatchcc719@gmail.com',
      web: 'sasquatchcarpet.com',
    },
    customer: { name: 'Test Customer', phone: '(719) 555-0000' },
    address: '123 Red Rock Ln, Monument, CO 80132',
    loss: {
      category: 1,
      categoryHistory: [],
      source: 'supply_line',
      lossDate: '2026-08-26',
      narrative: null,
      afterHours: false,
      carrier: null,
      claimNumber: null,
    },
    closedAt: '2026-09-01T18:00:00Z',
    visits: [
      {
        label: 'Mitigation',
        type: 'mitigation',
        date: '2026-08-29',
        note: null,
        lines: [],
      },
      {
        label: 'Final visit',
        type: 'final',
        date: '2026-09-01',
        note: null,
        lines: [],
      },
    ],
    equipment: [],
    readingPoints: [],
    airReadings: [],
    photos: [],
    floorPlan: null,
    totals: {
      work: 0,
      equipment: 0,
      grossSubtotal: 0,
      deductibleCredit: 0,
      subtotal: 0,
      paid: 0,
      balance: 0,
    },
    includePhotos: false,
    ...overrides,
  }
}

const point = (label: string, dryStandard: number | null, final: number) => ({
  label,
  material: 'Framing',
  dryStandard,
  readings: [
    { value: final + 10, takenAt: '2026-08-29T10:00:00Z' },
    { value: final, takenAt: '2026-09-01T10:00:00Z' },
  ],
})

describe('the drying goal', () => {
  it('is the dry standard plus the same tolerance the screen colours a pin green at', () => {
    // The office and the claim file must not disagree about one reading.
    expect(dryingGoalFor(10)).toBe(10 + DRY_WITHIN)
    expect(moistureBand(dryingGoalFor(10), 10)).toBe('dry')
    expect(moistureBand(dryingGoalFor(10) + 0.1, 10)).not.toBe('dry')
  })
})

describe('what the certificate is willing to say', () => {
  it('says every point met its goal only when every point did', () => {
    const cert = buildDryingCertificate(
      base({
        readingPoints: [point('North wall', 10, 11), point('Closet', 10, 12)],
      }),
    )
    expect(cert?.allMet).toBe(true)
    expect(cert?.metCount).toBe(2)
  })

  it('refuses to call a point met when it is over goal, and names it', () => {
    const cert = buildDryingCertificate(
      base({
        readingPoints: [point('North wall', 10, 11), point('Closet', 10, 18)],
      }),
    )
    expect(cert?.allMet).toBe(false)
    expect(cert?.metCount).toBe(1)
    expect(cert?.points.find((p) => p.label === 'Closet')?.met).toBe(false)
  })

  it('never rounds a failing reading down into compliance', () => {
    // 12.04 displays as 12.0 against a goal of 12.0 — met on the printed
    // numbers, which is what the document has to be judged on.
    const cert = buildDryingCertificate(
      base({ readingPoints: [point('Edge case', 10, 12.04)] }),
    )
    expect(cert?.points[0].met).toBe(true)
    // 12.06 displays as 12.1, which is over, and must read NOT MET.
    const over = buildDryingCertificate(
      base({ readingPoints: [point('Edge case', 10, 12.06)] }),
    )
    expect(over?.points[0].met).toBe(false)
  })

  it('excludes a point with no dry standard rather than guessing, and counts it for disclosure', () => {
    const cert = buildDryingCertificate(
      base({
        readingPoints: [
          point('Framing', 10, 11),
          point('Drywall, no standard', null, 4),
        ],
      }),
    )
    expect(cert?.points).toHaveLength(1)
    expect(cert?.excludedPointCount).toBe(1)
    expect(cert?.allMet).toBe(true)
  })

  it('does not exist at all when nothing was measured against a standard', () => {
    expect(buildDryingCertificate(base({ readingPoints: [] }))).toBeNull()
    expect(
      buildDryingCertificate(
        base({ readingPoints: [point('No standard', null, 4)] }),
      ),
    ).toBeNull()
  })

  it('dates itself from the close, and knows whether a real final visit happened', () => {
    const cert = buildDryingCertificate(
      base({ readingPoints: [point('North wall', 10, 11)] }),
    )
    expect(cert?.issuedOn).toBe('2026-09-01T18:00:00Z')
    expect(cert?.finalVisitIsFinal).toBe(true)
    expect(cert?.firstVisitDate).toBe('2026-08-29')
    expect(cert?.finalVisitDate).toBe('2026-09-01')
  })

  it('falls back to the last visit when the project is still open', () => {
    const cert = buildDryingCertificate(
      base({
        closedAt: null,
        readingPoints: [point('North wall', 10, 11)],
        visits: [
          {
            label: 'Mitigation',
            type: 'mitigation',
            date: '2026-08-29',
            note: null,
            lines: [],
          },
          {
            label: 'Monitoring visit',
            type: 'monitor',
            date: '2026-08-31',
            note: null,
            lines: [],
          },
        ],
      }),
    )
    expect(cert?.issuedOn).toBe('2026-08-31')
    // No `final` visit happened, so the document must not label one.
    expect(cert?.finalVisitIsFinal).toBe(false)
  })
})

/**
 * The wording rules, enforced against the source rather than the rendered
 * bytes — a PDF compresses its text streams, so a byte scan would pass while
 * the words were on the page, which is the worst possible outcome for a test
 * like this.
 */
describe('how the certificate is worded', () => {
  const source = readFileSync(
    new URL('./drying-certificate.tsx', import.meta.url),
    'utf8',
  )
  // Comments explain the rules and naturally quote the words they forbid.
  const rendered = source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
  /** Line breaks in JSX are not meaning — collapse them before matching. */
  const flat = rendered.replace(/\s+/g, ' ')

  it('never claims the structure itself is dry', () => {
    // The bounded claim — each point reached the goal set for it, against a
    // benchmark printed on the same page — is the whole basis of the document.
    expect(flat).toContain('had reached the drying goals')
    expect(rendered).not.toMatch(/the structure is dry/)
  })

  it('cites the S500 method but never the certifying body', () => {
    // Charles, 2026-08-31: "I don't want you to mention IICRC whatsoever. Yes
    // I have my ASD certification, but it's been lapsed for years."
    //
    // The S500 is the standard the method comes from and an adjuster
    // recognises it. The IICRC certifies people, and naming it next to his
    // signature implies a credential he no longer holds.
    expect(flat).toContain('S500')
    expect(rendered).not.toMatch(/IICRC/i)
    expect(rendered).not.toMatch(/\bWRT\b|\bASD\b|certified by|accredited/i)
  })

  it('does not invent a tolerance and attribute it to a standard', () => {
    // An earlier draft derived the goal as "standard x 1.10" and footnoted it
    // as a "general-materials tolerance" from the standard. No such tolerance
    // exists — a checkable false citation on a document that goes to a carrier.
    expect(rendered).not.toMatch(/general.materials tolerance/i)
    expect(rendered).not.toMatch(/performed and documented consistent with/i)
  })

  /**
   * Charles, 2026-08-31, on the first terms sheet: *"it has to be written in a
   * way that actually supports the company and doesn't just try to shed every
   * bit of liability."*
   *
   * The terms describe the work. The boundaries are still all there, but they
   * fall out of explaining the method rather than being a list of denials —
   * which is also the version that reads like a company that knows its trade.
   */
  it('leads with the method, not with denials', () => {
    expect(flat).toContain('How the drying was verified')
    expect(flat).toContain('a dry standard was recorded for each affected')
    expect(flat).toContain(
      'Drying equipment stayed in place until the readings',
    )
  })

  it('states the reach of a meter as a fact about meters', () => {
    expect(flat).toContain(
      'A moisture meter reads the material it is placed on',
    )
    expect(flat).toContain('cannot be read from the surface')
  })

  it('frames drying as what prevents growth, and names its own lane on mold', () => {
    expect(flat).toContain('Drying is how microbial growth is prevented')
    expect(flat).toContain('separate discipline from restoration drying')
    // No EPA hedge, no "makes no representation", no "not qualified".
    expect(rendered).not.toMatch(/Environmental Protection Agency/i)
    expect(rendered).not.toMatch(/makes no representation|not qualified to/i)
  })

  it('points a Category 2 or 3 loss at the scope of work rather than disclaiming it', () => {
    // The certificate covers drying. On a contaminated loss the removal and
    // cleaning is real work we did — it belongs pointed at, not denied.
    expect(flat).toContain('includes removing or cleaning affected materials')
    expect(flat).toContain('itemised in the scope of work')
    expect(rendered).toMatch(/cat >= 2/)
  })

  it('says who it is for without a reliance disclaimer', () => {
    expect(flat).toContain('Who this is issued to')
    expect(rendered).not.toMatch(/may not be relied upon/i)
    expect(rendered).not.toMatch(/prospective purchaser/i)
  })

  it('prints no "%" against readings the meter does not read in percent', () => {
    // Wood reads true moisture content; gypsum and concrete read a relative
    // scale, so a "%" there states a measurement never taken.
    expect(rendered).not.toMatch(/\{round1\([^)]+\)\}\s*%/)
  })
})
