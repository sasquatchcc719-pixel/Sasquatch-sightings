import React from 'react'
import { Document, Page, StyleSheet, Text, View } from '@react-pdf/renderer'
import {
  commercialUnit,
  lineAmount,
  phaseTotal,
  type CommercialAgreement,
} from '@/lib/ops/commercial'

const GREEN = '#2d6a4f'
const INK = '#173b36'
const MUTED = '#64748b'
const BORDER = '#d8e2dc'
const PALE = '#f4f7f2'

const styles = StyleSheet.create({
  page: {
    paddingTop: 32,
    paddingBottom: 46,
    paddingHorizontal: 36,
    fontFamily: 'Helvetica',
    fontSize: 9,
    color: INK,
  },
  header: {
    borderBottomWidth: 2,
    borderBottomColor: GREEN,
    paddingBottom: 14,
    marginBottom: 18,
  },
  brand: { fontSize: 9, letterSpacing: 1.5, color: GREEN },
  title: {
    marginTop: 6,
    fontFamily: 'Helvetica-Bold',
    fontSize: 22,
    color: '#16302c',
  },
  subtitle: { marginTop: 4, fontSize: 10, color: MUTED },
  metaRow: { flexDirection: 'row', gap: 12, marginBottom: 16 },
  meta: {
    flex: 1,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 5,
    padding: 9,
    backgroundColor: PALE,
  },
  label: {
    fontSize: 7,
    color: MUTED,
    textTransform: 'uppercase',
    letterSpacing: 0.7,
    marginBottom: 3,
  },
  value: { fontFamily: 'Helvetica-Bold', lineHeight: 1.35 },
  section: { marginTop: 14 },
  heading: {
    fontFamily: 'Helvetica-Bold',
    fontSize: 13,
    marginBottom: 7,
  },
  service: {
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 5,
    marginBottom: 7,
    padding: 9,
  },
  serviceTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 10,
  },
  serviceName: { fontFamily: 'Helvetica-Bold', fontSize: 10 },
  amount: { fontFamily: 'Helvetica-Bold', color: GREEN },
  phase: {
    marginTop: 2,
    fontSize: 7,
    color: GREEN,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  detail: { marginTop: 4, color: '#334155', lineHeight: 1.4 },
  term: { marginBottom: 8 },
  termTitle: { fontFamily: 'Helvetica-Bold', marginBottom: 2 },
  termBody: { color: '#334155', lineHeight: 1.45 },
  acceptance: {
    marginTop: 12,
    borderWidth: 1,
    borderColor: GREEN,
    borderRadius: 5,
    padding: 10,
    backgroundColor: PALE,
  },
  footer: {
    position: 'absolute',
    left: 36,
    right: 36,
    bottom: 22,
    flexDirection: 'row',
    justifyContent: 'space-between',
    color: MUTED,
    fontSize: 7,
  },
})

const money = (value: number) =>
  value.toLocaleString('en-US', { style: 'currency', currency: 'USD' })

export function CommercialAgreementPDF({
  agreement,
}: {
  agreement: CommercialAgreement
}) {
  const content = agreement.content
  const terms = [
    ['Payment terms', content.payment_terms],
    ['Cancellation and rescheduling', content.cancellation_terms],
    ['Access and preparation', content.access_terms],
    ['Quality and inspection', content.quality_standards],
    ['Exclusions and scope changes', content.exclusions],
    ['Additional terms', content.additional_terms],
  ]

  return (
    <Document title={`${content.title} — ${content.business_name}`}>
      <Page size="LETTER" style={styles.page} wrap>
        <View style={styles.header}>
          <Text style={styles.brand}>SASQUATCH CARPET CLEANING · COLORADO</Text>
          <Text style={styles.title}>{content.title}</Text>
          <Text style={styles.subtitle}>
            {content.business_name} · Version {agreement.version} · Published
            service terms
          </Text>
        </View>

        <View style={styles.metaRow}>
          <View style={styles.meta}>
            <Text style={styles.label}>Service location</Text>
            <Text style={styles.value}>
              {content.service_address || 'To be confirmed'}
            </Text>
          </View>
          <View style={styles.meta}>
            <Text style={styles.label}>Agreement period</Text>
            <Text style={styles.value}>
              {content.effective_from || 'Not set'} through{' '}
              {content.effective_until || 'no fixed end date'}
            </Text>
          </View>
          <View style={styles.meta}>
            <Text style={styles.label}>Sasquatch representative</Text>
            <Text style={styles.value}>
              {content.provider_name || 'Not specified'}
            </Text>
          </View>
        </View>

        <View style={styles.metaRow}>
          {(['initial', 'recurring', 'optional'] as const).map((phase) => (
            <View key={phase} style={styles.meta}>
              <Text style={styles.label}>{phase} scope total</Text>
              <Text style={styles.value}>
                {money(phaseTotal(content, phase))}
              </Text>
            </View>
          ))}
        </View>

        <View style={styles.section}>
          <Text style={styles.heading}>Services and measurements</Text>
          {content.lines.map((line) => (
            <View key={line.id} style={styles.service} wrap={false}>
              <View style={styles.serviceTop}>
                <View>
                  <Text style={styles.serviceName}>{line.name}</Text>
                  <Text style={styles.phase}>{line.phase} service</Text>
                </View>
                <Text style={styles.amount}>{money(lineAmount(line))}</Text>
              </View>
              <Text style={styles.detail}>
                {line.area || 'Area to be confirmed'} · {line.quantity}{' '}
                {commercialUnit(line.unit)} × {money(line.unit_price)}
              </Text>
              <Text style={styles.detail}>Method: {line.method}</Text>
              <Text style={styles.detail}>Frequency: {line.frequency}</Text>
              <Text style={styles.detail}>
                Service window:{' '}
                {line.service_window || 'By confirmed appointment'}
              </Text>
              {line.area_segments?.length ? (
                <Text style={styles.detail}>
                  Measurements:{' '}
                  {line.area_segments
                    .map((segment) => `${segment.length} × ${segment.width}`)
                    .join('; ')}
                </Text>
              ) : null}
              {line.notes ? (
                <Text style={styles.detail}>{line.notes}</Text>
              ) : null}
            </View>
          ))}
        </View>

        <View style={styles.section}>
          <Text style={styles.heading}>Service terms</Text>
          {terms.map(([title, value]) => (
            <View key={title} style={styles.term} wrap={false}>
              <Text style={styles.termTitle}>{title}</Text>
              <Text style={styles.termBody}>{value || 'Not specified'}</Text>
            </View>
          ))}
        </View>

        <View style={styles.acceptance} wrap={false}>
          <Text style={styles.termTitle}>Customer acceptance</Text>
          <Text style={styles.termBody}>
            This published copy is awaiting the customer&apos;s electronic
            signature in the secure Sasquatch customer portal. Reviewing this
            agreement does not schedule an appointment automatically.
          </Text>
        </View>

        <View style={styles.footer} fixed>
          <Text>Sasquatch Carpet Cleaning · (719) 249-8791</Text>
          <Text
            render={({ pageNumber, totalPages }) =>
              `Agreement v${agreement.version} · ${pageNumber}/${totalPages}`
            }
          />
        </View>
      </Page>
    </Document>
  )
}
