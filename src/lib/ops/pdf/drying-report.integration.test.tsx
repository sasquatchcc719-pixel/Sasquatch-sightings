// @vitest-environment node
/**
 * The drying report must actually render. A report that throws on a real job is
 * worse than no report, because it fails at the moment it is being handed over.
 */
import { describe, it, expect } from 'vitest'
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
      { category: 1, effectiveAt: '2026-08-26T08:00:00Z', reason: 'clean at time of loss' },
      { category: 3, effectiveAt: '2026-08-30T09:00:00Z', reason: 'contaminated, 4 day dwell' },
    ],
    source: 'exterior_groundwater',
    lossDate: '2026-08-26',
    narrative: 'Water entered through a basement window and sat roughly four days.',
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
        { description: 'EXTS - Water extraction, Cat 3', quantity: 400, unit: 'SF', total: 588 },
        { description: 'FCCS - Tear out carpet, Cat 3', quantity: 400, unit: 'SF', total: 440 },
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
    { role: 'affected', location: 'Basement', tempF: 78, rhPct: 62, takenAt: '2026-08-29T10:00:00Z' },
    { role: 'outside', location: 'Outside', tempF: 71, rhPct: 44, takenAt: '2026-08-29T10:00:00Z' },
    { role: 'dehu_intake', location: 'Dehu by stairs', tempF: 78, rhPct: 62, takenAt: '2026-08-31T10:00:00Z' },
    { role: 'dehu_outlet', location: 'Dehu by stairs', tempF: 92, rhPct: 22, takenAt: '2026-08-31T10:00:00Z' },
    { role: 'affected', location: 'Basement', tempF: 76, rhPct: 38, takenAt: '2026-08-31T10:05:00Z' },
  ],
  photos: [],
  totals: { work: 1028, equipment: 630, subtotal: 1658, paid: 1000, balance: 658 },
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
      loss: { ...BASE.loss, categoryHistory: [], narrative: null, source: null, lossDate: null },
      visits: [],
      equipment: [],
      readingPoints: [],
      airReadings: [],
      totals: { work: 0, equipment: 0, subtotal: 0, paid: 0, balance: 0 },
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
      <DryingReportPDF data={{ ...BASE, visits: BASE.visits.map((v) => ({ ...v, note: null })) }} />,
    )
    expect(buffer.length).toBeGreaterThan(withoutNotes.length)
  }, 30_000)
})
