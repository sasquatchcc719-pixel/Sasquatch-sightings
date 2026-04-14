import React from 'react'
import { Document, Page, StyleSheet, Text, View } from '@react-pdf/renderer'

export type InvoiceLineItem = {
  description: string
  quantity: number
  unit_price: number
  line_total: number
}

export type InvoicePDFData = {
  invoiceId: string
  isPaid: boolean
  paymentMethod?: string | null
  customerName: string
  serviceAddress: string
  serviceDate: string
  lineItems: InvoiceLineItem[]
  discountAmount: number
  subtotal: number
  total: number
  venmoUrl?: string | null
}

const GREEN = '#16a34a'
const DARK = '#111827'
const MID = '#374151'
const LIGHT = '#6b7280'
const BORDER = '#e5e7eb'
const BG_ROW = '#f9fafb'

const styles = StyleSheet.create({
  page: {
    fontFamily: 'Helvetica',
    fontSize: 10,
    color: DARK,
    paddingTop: 0,
    paddingBottom: 40,
    paddingHorizontal: 0,
  },
  // ── Header band ────────────────────────────────────────────────────────
  header: {
    backgroundColor: GREEN,
    paddingVertical: 22,
    paddingHorizontal: 36,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
  },
  companyName: {
    color: '#ffffff',
    fontSize: 20,
    fontFamily: 'Helvetica-Bold',
  },
  companyTagline: {
    color: '#bbf7d0',
    fontSize: 9,
    marginTop: 2,
  },
  headerRight: {
    alignItems: 'flex-end',
  },
  docLabel: {
    color: '#ffffff',
    fontSize: 14,
    fontFamily: 'Helvetica-Bold',
  },
  invoiceRef: {
    color: '#bbf7d0',
    fontSize: 9,
    marginTop: 3,
  },
  // ── Body ───────────────────────────────────────────────────────────────
  body: {
    paddingHorizontal: 36,
    paddingTop: 24,
  },
  // ── Info block ─────────────────────────────────────────────────────────
  infoRow: {
    flexDirection: 'row',
    marginBottom: 20,
  },
  infoBlock: {
    flex: 1,
  },
  infoLabel: {
    fontSize: 8,
    color: LIGHT,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 3,
  },
  infoValue: {
    fontSize: 10,
    color: DARK,
    fontFamily: 'Helvetica-Bold',
  },
  infoSub: {
    fontSize: 9,
    color: MID,
    marginTop: 1,
  },
  divider: {
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
    marginBottom: 16,
  },
  // ── Table ──────────────────────────────────────────────────────────────
  tableHeader: {
    flexDirection: 'row',
    backgroundColor: BG_ROW,
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderWidth: 1,
    borderColor: BORDER,
    borderBottomWidth: 0,
  },
  tableRow: {
    flexDirection: 'row',
    paddingVertical: 7,
    paddingHorizontal: 8,
    borderWidth: 1,
    borderColor: BORDER,
    borderTopWidth: 0,
  },
  tableRowAlt: {
    backgroundColor: BG_ROW,
  },
  colDesc: { flex: 3 },
  colQty: { flex: 1, textAlign: 'right' },
  colUnit: { flex: 1, textAlign: 'right' },
  colTotal: { flex: 1, textAlign: 'right' },
  thText: {
    fontSize: 8,
    fontFamily: 'Helvetica-Bold',
    color: MID,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  tdText: {
    fontSize: 9,
    color: DARK,
  },
  // ── Totals block ───────────────────────────────────────────────────────
  totalsBlock: {
    alignItems: 'flex-end',
    marginTop: 12,
  },
  totalRow: {
    flexDirection: 'row',
    width: 200,
    paddingVertical: 3,
  },
  totalLabel: {
    flex: 1,
    fontSize: 9,
    color: LIGHT,
    textAlign: 'right',
    paddingRight: 12,
  },
  totalValue: {
    width: 70,
    fontSize: 9,
    color: DARK,
    textAlign: 'right',
  },
  grandTotalRow: {
    flexDirection: 'row',
    width: 200,
    paddingVertical: 6,
    borderTopWidth: 1,
    borderTopColor: BORDER,
    marginTop: 4,
  },
  grandTotalLabel: {
    flex: 1,
    fontSize: 11,
    fontFamily: 'Helvetica-Bold',
    color: DARK,
    textAlign: 'right',
    paddingRight: 12,
  },
  grandTotalValue: {
    width: 70,
    fontSize: 11,
    fontFamily: 'Helvetica-Bold',
    color: GREEN,
    textAlign: 'right',
  },
  // ── Venmo CTA ──────────────────────────────────────────────────────────
  venmoBox: {
    marginTop: 28,
    borderWidth: 1,
    borderColor: '#93c5fd',
    backgroundColor: '#eff6ff',
    borderRadius: 6,
    padding: 14,
  },
  venmoLabel: {
    fontSize: 9,
    color: '#1d4ed8',
    fontFamily: 'Helvetica-Bold',
    marginBottom: 4,
  },
  venmoUrl: {
    fontSize: 9,
    color: '#1d4ed8',
  },
  // ── PAID stamp ─────────────────────────────────────────────────────────
  paidStampContainer: {
    position: 'absolute',
    top: 160,
    right: 36,
    transform: 'rotate(-22deg)',
  },
  paidStamp: {
    borderWidth: 4,
    borderColor: '#16a34a',
    borderRadius: 4,
    paddingVertical: 6,
    paddingHorizontal: 14,
    opacity: 0.25,
  },
  paidStampText: {
    fontSize: 40,
    fontFamily: 'Helvetica-Bold',
    color: '#16a34a',
    letterSpacing: 6,
  },
  paidMethodBox: {
    marginTop: 28,
    borderWidth: 1,
    borderColor: '#bbf7d0',
    backgroundColor: '#f0fdf4',
    borderRadius: 6,
    padding: 14,
  },
  paidMethodLabel: {
    fontSize: 9,
    color: GREEN,
    fontFamily: 'Helvetica-Bold',
    marginBottom: 2,
  },
  paidMethodText: {
    fontSize: 9,
    color: MID,
  },
  // ── Footer ─────────────────────────────────────────────────────────────
  footer: {
    position: 'absolute',
    bottom: 24,
    left: 36,
    right: 36,
    borderTopWidth: 1,
    borderTopColor: BORDER,
    paddingTop: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  footerText: {
    fontSize: 8,
    color: LIGHT,
  },
})

function fmt(amount: number) {
  return `$${amount.toFixed(2)}`
}

function shortRef(id: string) {
  return `INV-${id.replace(/-/g, '').slice(-6).toUpperCase()}`
}

function formatPaymentMethod(method: string | null | undefined): string {
  if (!method) return 'Payment received'
  const map: Record<string, string> = {
    cash: 'Cash',
    card: 'Credit / Debit Card',
    venmo: 'Venmo',
    check: 'Check',
    zelle: 'Zelle',
    other: 'Other',
  }
  return map[method.toLowerCase()] ?? method
}

export function InvoicePDF({ data }: { data: InvoicePDFData }) {
  const ref = shortRef(data.invoiceId)
  const docTitle = data.isPaid ? 'Receipt' : 'Invoice'

  return (
    <Document title={`Sasquatch Carpet Cleaning ${docTitle} ${ref}`}>
      <Page size="LETTER" style={styles.page}>
        {/* ── Header ── */}
        <View style={styles.header}>
          <View>
            <Text style={styles.companyName}>Sasquatch Carpet Cleaning</Text>
            <Text style={styles.companyTagline}>sasquatchcarpet.com</Text>
          </View>
          <View style={styles.headerRight}>
            <Text style={styles.docLabel}>{docTitle.toUpperCase()}</Text>
            <Text style={styles.invoiceRef}>{ref}</Text>
          </View>
        </View>

        {/* ── PAID watermark (receipt only) ── */}
        {data.isPaid && (
          <View style={styles.paidStampContainer}>
            <View style={styles.paidStamp}>
              <Text style={styles.paidStampText}>PAID</Text>
            </View>
          </View>
        )}

        <View style={styles.body}>
          {/* ── Customer / Date info ── */}
          <View style={styles.infoRow}>
            <View style={styles.infoBlock}>
              <Text style={styles.infoLabel}>Bill To</Text>
              <Text style={styles.infoValue}>{data.customerName}</Text>
              <Text style={styles.infoSub}>{data.serviceAddress}</Text>
            </View>
            <View style={styles.infoBlock}>
              <Text style={styles.infoLabel}>Service Date</Text>
              <Text style={styles.infoValue}>{data.serviceDate}</Text>
            </View>
            <View style={styles.infoBlock}>
              <Text style={styles.infoLabel}>Reference</Text>
              <Text style={styles.infoValue}>{ref}</Text>
            </View>
          </View>

          <View style={styles.divider} />

          {/* ── Line items table ── */}
          <View style={styles.tableHeader}>
            <Text style={[styles.thText, styles.colDesc]}>Description</Text>
            <Text style={[styles.thText, styles.colQty]}>Qty</Text>
            <Text style={[styles.thText, styles.colUnit]}>Unit Price</Text>
            <Text style={[styles.thText, styles.colTotal]}>Total</Text>
          </View>
          {data.lineItems.map((item, idx) => (
            <View
              key={idx}
              style={[styles.tableRow, idx % 2 === 1 ? styles.tableRowAlt : {}]}
            >
              <Text style={[styles.tdText, styles.colDesc]}>
                {item.description}
              </Text>
              <Text style={[styles.tdText, styles.colQty]}>
                {item.quantity}
              </Text>
              <Text style={[styles.tdText, styles.colUnit]}>
                {fmt(item.unit_price)}
              </Text>
              <Text style={[styles.tdText, styles.colTotal]}>
                {fmt(item.line_total)}
              </Text>
            </View>
          ))}

          {/* ── Totals ── */}
          <View style={styles.totalsBlock}>
            {data.discountAmount > 0 && (
              <>
                <View style={styles.totalRow}>
                  <Text style={styles.totalLabel}>Subtotal</Text>
                  <Text style={styles.totalValue}>{fmt(data.subtotal)}</Text>
                </View>
                <View style={styles.totalRow}>
                  <Text style={styles.totalLabel}>Discount</Text>
                  <Text style={[styles.totalValue, { color: GREEN }]}>
                    -{fmt(data.discountAmount)}
                  </Text>
                </View>
              </>
            )}
            <View style={styles.grandTotalRow}>
              <Text style={styles.grandTotalLabel}>
                {data.isPaid ? 'Total Paid' : 'Total Due'}
              </Text>
              <Text style={styles.grandTotalValue}>{fmt(data.total)}</Text>
            </View>
          </View>

          {/* ── Invoice CTA: Venmo ── */}
          {!data.isPaid && data.venmoUrl && (
            <View style={styles.venmoBox}>
              <Text style={styles.venmoLabel}>Pay Online</Text>
              <Text style={styles.venmoUrl}>{data.venmoUrl}</Text>
            </View>
          )}

          {/* ── Receipt: payment method confirmation ── */}
          {data.isPaid && (
            <View style={styles.paidMethodBox}>
              <Text style={styles.paidMethodLabel}>Payment Confirmed</Text>
              <Text style={styles.paidMethodText}>
                {formatPaymentMethod(data.paymentMethod)} — thank you!
              </Text>
            </View>
          )}
        </View>

        {/* ── Footer ── */}
        <View style={styles.footer} fixed>
          <Text style={styles.footerText}>
            Sasquatch Carpet Cleaning · sasquatchcc719@gmail.com
          </Text>
          <Text style={styles.footerText}>
            Questions? Call or text us anytime.
          </Text>
        </View>
      </Page>
    </Document>
  )
}
