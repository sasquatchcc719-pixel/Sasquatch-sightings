// @vitest-environment node
/**
 * The drying report must actually render. A report that throws on a real job is
 * worse than no report, because it fails at the moment it is being handed over.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { renderToBuffer } from '@react-pdf/renderer'
import { DryingReportPDF, type DryingReportData } from './drying-report'

const BASE: DryingReportData = {
  company: {
    name: 'Sasquatch Carpet Cleaning',
    phone: '(719) 249-8791',
    email: 'sasquatchcc719@gmail.com',
    web: 'sasquatchcarpet.com',
  },
  customer: { name: 'Test Customer', phone: '(719) 555-0000' },
  address: '123 Red Rock Ln, Monument, CO 80132',
  loss: {
    category: 3,
    categoryHistory: [
      {
        category: 1,
        effectiveAt: '2026-08-26T08:00:00Z',
        reason: 'clean at time of loss',
      },
      {
        category: 3,
        effectiveAt: '2026-08-30T09:00:00Z',
        reason: 'contaminated, 4 day dwell',
      },
    ],
    source: 'exterior_groundwater',
    lossDate: '2026-08-26',
    narrative:
      'Water entered through a basement window and sat roughly four days.',
    afterHours: false,
    carrier: null,
    claimNumber: null,
  },
  visits: [
    {
      label: 'Mitigation',
      date: '2026-08-30',
      note: null,
      lines: [
        {
          description: 'EXTS - Water extraction, Cat 3',
          quantity: 400,
          unit: 'SF',
          total: 588,
        },
        {
          description: 'FCCS - Tear out carpet, Cat 3',
          quantity: 400,
          unit: 'SF',
          total: 440,
        },
      ],
    },
    {
      label: 'Monitoring visit',
      date: '2026-08-31',
      note: 'North wall down to 14%. Closet still reading high; moved one air mover into it.',
      lines: [],
    },
  ],
  equipment: [
    {
      code: 'DRY++',
      description: 'Axial fan air mover - 1 HP',
      units: 6,
      unitDays: 18,
      total: 630,
    },
  ],
  readingPoints: [
    {
      label: 'North wall, base',
      material: 'Drywall',
      dryStandard: 16,
      readings: [
        { value: 24.5, takenAt: '2026-08-30T10:00:00Z' },
        { value: 19.2, takenAt: '2026-08-31T10:00:00Z' },
        { value: 14.1, takenAt: '2026-09-01T10:00:00Z' },
      ],
    },
  ],
  airReadings: [
    {
      role: 'affected',
      location: 'Basement',
      tempF: 78,
      rhPct: 62,
      takenAt: '2026-08-29T10:00:00Z',
    },
    {
      role: 'outside',
      location: 'Outside',
      tempF: 71,
      rhPct: 44,
      takenAt: '2026-08-29T10:00:00Z',
    },
    {
      role: 'dehu_intake',
      location: 'Dehu by stairs',
      tempF: 78,
      rhPct: 62,
      takenAt: '2026-08-31T10:00:00Z',
    },
    {
      role: 'dehu_outlet',
      location: 'Dehu by stairs',
      tempF: 92,
      rhPct: 22,
      takenAt: '2026-08-31T10:00:00Z',
    },
    {
      role: 'affected',
      location: 'Basement',
      tempF: 76,
      rhPct: 38,
      takenAt: '2026-08-31T10:05:00Z',
    },
  ],
  photos: [],
  floorPlan: {
    walls: [
      { x1: 0, y1: 0, x2: 12, y2: 0 },
      { x1: 12, y1: 0, x2: 12, y2: 10 },
      { x1: 12, y1: 10, x2: 0, y2: 10 },
      { x1: 0, y1: 10, x2: 0, y2: 0 },
    ],
    openings: [{ x: 6, y: 0, angleDeg: 0, kind: 'doorway', widthFt: 3 }],
    equipment: [
      { x: 3, y: 3, glyph: 'AM', shape: 'dot', removed: false },
      { x: 9, y: 7, glyph: 'LG', shape: 'box', removed: false },
    ],
    readingPoints: [{ x: 2, y: 8, label: 'North wall, base' }],
  },
  totals: {
    work: 1028,
    equipment: 630,
    grossSubtotal: 1658,
    deductibleCredit: 0,
    subtotal: 1658,
    paid: 1000,
    balance: 658,
  },
  includePhotos: false,
}

async function render(data: DryingReportData) {
  return Buffer.from(await renderToBuffer(<DryingReportPDF data={data} />))
}

describe('drying report', () => {
  it('renders a complete job to a valid PDF', async () => {
    const buffer = await render(BASE)
    expect(buffer.subarray(0, 5).toString()).toBe('%PDF-')
    expect(buffer.length).toBeGreaterThan(2000)
  }, 30_000)

  it('renders a job with nothing recorded yet', async () => {
    const buffer = await render({
      ...BASE,
      loss: {
        ...BASE.loss,
        categoryHistory: [],
        narrative: null,
        source: null,
        lossDate: null,
      },
      visits: [],
      equipment: [],
      readingPoints: [],
      airReadings: [],
      totals: {
        work: 0,
        equipment: 0,
        grossSubtotal: 0,
        deductibleCredit: 0,
        subtotal: 0,
        paid: 0,
        balance: 0,
      },
    })
    expect(buffer.subarray(0, 5).toString()).toBe('%PDF-')
  }, 30_000)

  it('renders without a deposit, showing a total rather than a balance', async () => {
    const buffer = await render({
      ...BASE,
      totals: { ...BASE.totals, paid: 0, balance: 1658 },
    })
    expect(buffer.subarray(0, 5).toString()).toBe('%PDF-')
  }, 30_000)
})

describe('the drying trend', () => {
  it('plots one line per point once there are two days of readings', async () => {
    const buffer = await renderToBuffer(<DryingReportPDF data={BASE} />)
    // The chart is vector, so a rendered chart makes the document meaningfully
    // larger than the same document without one.
    const flat: DryingReportData = {
      ...BASE,
      readingPoints: BASE.readingPoints.map((p) => ({
        ...p,
        readings: p.readings.slice(0, 1),
      })),
    }
    const withoutChart = await renderToBuffer(<DryingReportPDF data={flat} />)
    expect(buffer.length).toBeGreaterThan(withoutChart.length)
  }, 30_000)

  it('carries the daily notes into the document', async () => {
    const buffer = await renderToBuffer(<DryingReportPDF data={BASE} />)
    const withoutNotes = await renderToBuffer(
      <DryingReportPDF
        data={{
          ...BASE,
          visits: BASE.visits.map((v) => ({ ...v, note: null })),
        }}
      />,
    )
    expect(buffer.length).toBeGreaterThan(withoutNotes.length)
  }, 30_000)
})

describe('what never reaches the customer', () => {
  /**
   * Charles's standing rule, first given about Category 3 warnings: internal
   * guidance is for us, not for a document a customer or an adjuster reads —
   * "I don't want you writing all over a fucking customer's invoice."
   *
   * The atmospheric verdicts broke it. The report was printing "check the
   * filter, the coils, and that it is actually running" and "Drying has
   * stalled" into a claim file. Readings are facts; diagnoses are not.
   *
   * Asserted against the SOURCE rather than the rendered bytes, because a PDF
   * compresses its text streams — a byte scan would pass while the words were
   * on the page, which is the worst possible outcome for a test like this.
   */
  const source = readFileSync(
    new URL('./drying-report.tsx', import.meta.url),
    'utf8',
  )

  /**
   * Comments removed: they explain the rule and naturally quote the words it
   * forbids. Only what could actually be rendered is examined.
   */
  const rendered = source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')

  it('does not reach for a verdict helper at all', () => {
    for (const helper of [
      'dehumidifierVerdict',
      'dryGoalVerdict',
      'trendVerdict',
      'ventilationNote',
      'BAND_LABEL',
    ]) {
      expect(rendered).not.toContain(helper)
    }
  })

  it('carries no diagnostic wording of its own', () => {
    for (const phrase of [
      'coils',
      'stalled',
      'not keeping up',
      'not working',
    ]) {
      expect(rendered.toLowerCase()).not.toContain(phrase)
    }
  })

  it('still prints the readings themselves', async () => {
    // The table is the evidence; the reader draws the conclusion.
    const wet: DryingReportData = {
      ...BASE,
      airReadings: [
        {
          role: 'affected',
          location: 'Basement',
          tempF: 80,
          rhPct: 70,
          takenAt: '2026-08-31T09:00:00-06:00',
        },
      ],
    }
    const withAir = await renderToBuffer(<DryingReportPDF data={wet} />)
    const withoutAir = await renderToBuffer(
      <DryingReportPDF data={{ ...wet, airReadings: [] }} />,
    )
    expect(withAir.length).toBeGreaterThan(withoutAir.length)
  }, 30_000)
})
