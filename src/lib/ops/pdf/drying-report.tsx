import React from 'react'
import { Document, Image, Page, StyleSheet, Text, View } from '@react-pdf/renderer'

/**
 * The drying report: the document that makes a water loss defensible.
 *
 * It is the deliverable an adjuster or a homeowner actually reads — the scope
 * of work priced to Xactimate, the equipment that ran and for how long, and the
 * moisture readings trending down to the dry standard, with photographs.
 */

export type DryingReportData = {
  company: { name: string; phone: string; email: string; web: string }
  customer: { name: string; phone: string | null }
  address: string
  loss: {
    category: number | null
    categoryHistory: Array<{ category: number; effectiveAt: string; reason: string | null }>
    source: string | null
    lossDate: string | null
    narrative: string | null
    afterHours: boolean
    carrier: string | null
    claimNumber: string | null
  }
  visits: Array<{
    label: string
    date: string
    lines: Array<{ description: string; quantity: number; unit: string | null; total: number }>
  }>
  equipment: Array<{
    code: string
    description: string
    units: number
    unitDays: number
    total: number
  }>
  readingPoints: Array<{
    label: string
    material: string | null
    dryStandard: number | null
    readings: Array<{ value: number; takenAt: string }>
  }>
  airReadings: Array<{
    location: string
    tempF: number | null
    rhPct: number | null
    takenAt: string
  }>
  photos: Array<{ url: string; phase: string | null }>
  totals: { work: number; equipment: number; subtotal: number; paid: number; balance: number }
  includePhotos: boolean
}

const styles = StyleSheet.create({
  page: { padding: 36, fontSize: 9, fontFamily: 'Helvetica', color: '#16242b' },
  header: { borderBottomWidth: 2, borderBottomColor: '#0e6577', paddingBottom: 8, marginBottom: 14 },
  title: { fontSize: 18, fontFamily: 'Helvetica-Bold', color: '#0e6577' },
  sub: { fontSize: 9, color: '#5c757f', marginTop: 2 },
  section: { marginTop: 14 },
  h2: {
    fontSize: 11,
    fontFamily: 'Helvetica-Bold',
    marginBottom: 6,
    paddingBottom: 3,
    borderBottomWidth: 1,
    borderBottomColor: '#cfdde2',
  },
  row: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 3 },
  cell: { flexGrow: 1 },
  muted: { color: '#5c757f' },
  right: { textAlign: 'right' },
  kv: { flexDirection: 'row', marginBottom: 2 },
  kvKey: { width: 92, color: '#5c757f' },
  badge: {
    fontFamily: 'Helvetica-Bold',
    color: '#ffffff',
    backgroundColor: '#9c3a2a',
    paddingVertical: 2,
    paddingHorizontal: 6,
    borderRadius: 3,
    fontSize: 9,
  },
  tableHead: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#16242b',
    paddingBottom: 3,
    marginBottom: 4,
    fontFamily: 'Helvetica-Bold',
  },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: '#16242b',
    paddingTop: 4,
    marginTop: 4,
    fontFamily: 'Helvetica-Bold',
  },
  photoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  photo: { width: 118, height: 88, objectFit: 'cover', marginRight: 6, marginBottom: 6 },
  footer: { position: 'absolute', bottom: 20, left: 36, right: 36, fontSize: 7, color: '#8aa0a9' },
})

const money = (n: number) =>
  `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

/**
 * A date-only string like "2026-08-26" parses as UTC midnight, which renders as
 * the previous day anywhere west of Greenwich. Read those as a local calendar
 * date; anything with a time in it is a real instant and converts normally.
 */
const day = (value: string) => {
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (dateOnly) {
    const [, y, m, d] = dateOnly
    return new Date(Number(y), Number(m) - 1, Number(d)).toLocaleDateString('en-US')
  }
  return new Date(value).toLocaleDateString('en-US')
}

export function DryingReportPDF({ data }: { data: DryingReportData }) {
  const cat = data.loss.category ?? 1

  return (
    <Document>
      <Page size="LETTER" style={styles.page}>
        <View style={styles.header}>
          <Text style={styles.title}>Water Mitigation Report</Text>
          <Text style={styles.sub}>
            {data.company.name} · {data.company.phone} · {data.company.web}
          </Text>
        </View>

        <View style={styles.row}>
          <View style={styles.cell}>
            <View style={styles.kv}>
              <Text style={styles.kvKey}>Customer</Text>
              <Text>{data.customer.name}</Text>
            </View>
            <View style={styles.kv}>
              <Text style={styles.kvKey}>Property</Text>
              <Text>{data.address}</Text>
            </View>
            {data.loss.lossDate ? (
              <View style={styles.kv}>
                <Text style={styles.kvKey}>Date of loss</Text>
                <Text>{day(data.loss.lossDate)}</Text>
              </View>
            ) : null}
          </View>
          <View style={{ width: 170 }}>
            <View style={styles.kv}>
              <Text style={styles.kvKey}>Category</Text>
              <Text style={cat === 3 ? styles.badge : undefined}>Category {cat}</Text>
            </View>
            {data.loss.source ? (
              <View style={styles.kv}>
                <Text style={styles.kvKey}>Source</Text>
                <Text>{data.loss.source.replace(/_/g, ' ')}</Text>
              </View>
            ) : null}
            {data.loss.carrier ? (
              <View style={styles.kv}>
                <Text style={styles.kvKey}>Carrier</Text>
                <Text>{data.loss.carrier}</Text>
              </View>
            ) : null}
            {data.loss.claimNumber ? (
              <View style={styles.kv}>
                <Text style={styles.kvKey}>Claim</Text>
                <Text>{data.loss.claimNumber}</Text>
              </View>
            ) : null}
          </View>
        </View>

        {data.loss.narrative ? (
          <View style={styles.section}>
            <Text style={styles.h2}>Cause of loss</Text>
            <Text>{data.loss.narrative}</Text>
          </View>
        ) : null}

        {data.loss.categoryHistory.length > 1 ? (
          <View style={styles.section}>
            <Text style={styles.h2}>Category classification</Text>
            {data.loss.categoryHistory.map((entry, index) => (
              <View key={index} style={styles.row}>
                <Text style={styles.cell}>
                  Category {entry.category}
                  {entry.reason ? ` — ${entry.reason}` : ''}
                </Text>
                <Text style={styles.muted}>{day(entry.effectiveAt)}</Text>
              </View>
            ))}
            <Text style={[styles.muted, { marginTop: 3 }]}>
              Per IICRC S500, category is assessed at the time work is performed; a
              Category 1 loss degrades with dwell time and contamination.
            </Text>
          </View>
        ) : null}

        <View style={styles.section}>
          <Text style={styles.h2}>Scope of work</Text>
          {data.visits.map((visit, vIndex) => (
            <View key={vIndex} style={{ marginBottom: 8 }}>
              <Text style={{ fontFamily: 'Helvetica-Bold', marginBottom: 3 }}>
                {visit.label} · {visit.date}
              </Text>
              {visit.lines.length === 0 ? (
                <Text style={styles.muted}>No billable work recorded.</Text>
              ) : (
                visit.lines.map((line, lIndex) => (
                  <View key={lIndex} style={styles.row}>
                    <Text style={styles.cell}>{line.description}</Text>
                    <Text style={{ width: 70, textAlign: 'right' }}>
                      {line.quantity} {line.unit ?? ''}
                    </Text>
                    <Text style={{ width: 60, textAlign: 'right' }}>{money(line.total)}</Text>
                  </View>
                ))
              )}
            </View>
          ))}
        </View>

        {data.equipment.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.h2}>Drying equipment</Text>
            <View style={styles.tableHead}>
              <Text style={styles.cell}>Equipment</Text>
              <Text style={{ width: 45, textAlign: 'right' }}>Units</Text>
              <Text style={{ width: 60, textAlign: 'right' }}>Unit-days</Text>
              <Text style={{ width: 60, textAlign: 'right' }}>Total</Text>
            </View>
            {data.equipment.map((item) => (
              <View key={item.code} style={styles.row}>
                <Text style={styles.cell}>{item.description}</Text>
                <Text style={{ width: 45, textAlign: 'right' }}>{item.units}</Text>
                <Text style={{ width: 60, textAlign: 'right' }}>{item.unitDays}</Text>
                <Text style={{ width: 60, textAlign: 'right' }}>{money(item.total)}</Text>
              </View>
            ))}
          </View>
        ) : null}

        <View style={styles.section}>
          <View style={styles.row}>
            <Text style={styles.cell}>Work</Text>
            <Text style={styles.right}>{money(data.totals.work)}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.cell}>Equipment</Text>
            <Text style={styles.right}>{money(data.totals.equipment)}</Text>
          </View>
          {data.totals.paid > 0 ? (
            <View style={styles.row}>
              <Text style={styles.cell}>Deposit received</Text>
              <Text style={styles.right}>-{money(data.totals.paid)}</Text>
            </View>
          ) : null}
          <View style={styles.totalRow}>
            <Text>{data.totals.paid > 0 ? 'Balance due' : 'Total'}</Text>
            <Text>
              {money(data.totals.paid > 0 ? data.totals.balance : data.totals.subtotal)}
            </Text>
          </View>
        </View>

        <Text style={styles.footer} fixed>
          {data.company.name} · Water mitigation report · Page 1
        </Text>
      </Page>

      <Page size="LETTER" style={styles.page}>
        <View style={styles.header}>
          <Text style={styles.title}>Drying Log</Text>
          <Text style={styles.sub}>{data.address}</Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.h2}>Material moisture readings</Text>
          {data.readingPoints.length === 0 ? (
            <Text style={styles.muted}>No monitoring points were recorded.</Text>
          ) : (
            data.readingPoints.map((point, index) => {
              const last = point.readings[point.readings.length - 1]
              const dry =
                point.dryStandard != null && last != null && last.value <= point.dryStandard
              return (
                <View key={index} style={{ marginBottom: 6 }}>
                  <View style={styles.row}>
                    <Text style={{ fontFamily: 'Helvetica-Bold' }}>
                      {point.label}
                      {point.material ? ` · ${point.material}` : ''}
                    </Text>
                    <Text style={styles.muted}>
                      {point.dryStandard != null ? `Dry standard ${point.dryStandard}%` : ''}
                      {dry ? ' · reached' : ''}
                    </Text>
                  </View>
                  <Text style={styles.muted}>
                    {point.readings.length > 0
                      ? point.readings
                          .map((r) => `${day(r.takenAt)}: ${r.value}%`)
                          .join('   ·   ')
                      : 'no readings'}
                  </Text>
                </View>
              )
            })
          )}
        </View>

        {data.airReadings.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.h2}>Atmospheric readings</Text>
            <View style={styles.tableHead}>
              <Text style={styles.cell}>Location</Text>
              <Text style={{ width: 80, textAlign: 'right' }}>Temp °F</Text>
              <Text style={{ width: 80, textAlign: 'right' }}>RH %</Text>
              <Text style={{ width: 80, textAlign: 'right' }}>Taken</Text>
            </View>
            {data.airReadings.map((reading, index) => (
              <View key={index} style={styles.row}>
                <Text style={styles.cell}>
                  {reading.location === 'reference'
                    ? 'Unaffected reference'
                    : reading.location === 'exterior'
                      ? 'Exterior'
                      : 'Affected area'}
                </Text>
                <Text style={{ width: 80, textAlign: 'right' }}>{reading.tempF ?? '—'}</Text>
                <Text style={{ width: 80, textAlign: 'right' }}>{reading.rhPct ?? '—'}</Text>
                <Text style={{ width: 80, textAlign: 'right' }}>{day(reading.takenAt)}</Text>
              </View>
            ))}
          </View>
        ) : null}

        {data.includePhotos && data.photos.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.h2}>Photographs</Text>
            <View style={styles.photoGrid}>
              {data.photos.slice(0, 24).map((photo, index) => (
                // react-pdf's Image is not an HTML img and takes no alt prop.
                // eslint-disable-next-line jsx-a11y/alt-text
                <Image key={index} src={photo.url} style={styles.photo} />
              ))}
            </View>
          </View>
        ) : null}

        <Text style={styles.footer} fixed>
          {data.company.name} · Water mitigation report · Page 2
        </Text>
      </Page>
    </Document>
  )
}
