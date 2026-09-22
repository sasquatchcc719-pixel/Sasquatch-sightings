import { createHash } from 'node:crypto'

export const RESTORATION_BILLING_SNAPSHOT_VERSION = 1
export const RESTORATION_REPORT_VERSION = 1
export const RESTORATION_REPORT_BUCKET = 'restoration-reports'

export type MonthlyRestorationCharge = {
  kind: 'work' | 'equipment'
  description: string
  serviceDate: string
  quantity: number
  unitPrice: number
  lineTotal: number
  serviceCatalogItemId: string | null
  restorationCatalogCode: string | null
  quickbooksItemId: string | null
  equipmentSpans?: Array<{
    placedOn: string
    removedOn: string
    units: number
    unitDays: number
  }>
}

export type MonthlyRestorationSnapshot = {
  version: number
  projectId: string
  customerId: string
  serviceDate: string
  serviceAddress: string
  closedAt: string
  charges: MonthlyRestorationCharge[]
  grossSubtotal: number
  deductibleCredit: number
  depositApplied: number
  invoiceDiscount: number
  amountDue: number
  refundDueCents: number
}

const round2 = (value: number) => Math.round(value * 100) / 100

export function effectiveBillingMode(
  customerMode: string | null | undefined,
  templateMode?: string | null,
): 'immediate' | 'monthly_consolidated' {
  return customerMode === 'monthly_consolidated' ||
    templateMode === 'batch_monthly'
    ? 'monthly_consolidated'
    : 'immediate'
}

export function attachmentRollup(
  statuses: string[],
): 'not_required' | 'pending' | 'partial' | 'complete' {
  if (statuses.length === 0) return 'not_required'
  if (statuses.every((status) => status === 'attached')) return 'complete'
  if (statuses.some((status) => status === 'failed')) return 'partial'
  return 'pending'
}

export function monthStart(date: string): string {
  return `${date.slice(0, 7)}-01`
}

/**
 * Freeze the exact financial contribution a restoration project will make to
 * a future consolidated invoice. Deposits are represented as an invoice-level
 * adjustment, not another charge, so the customer is never billed twice.
 */
export function buildMonthlyRestorationSnapshot(input: {
  projectId: string
  customerId: string
  serviceDate: string
  serviceAddress: string
  closedAt: string
  charges: MonthlyRestorationCharge[]
  grossSubtotal: number
  deductibleCredit: number
  depositCents: number
  refundDueCents: number
}): MonthlyRestorationSnapshot {
  const grossSubtotal = round2(Math.max(0, input.grossSubtotal))
  const deductibleCredit = round2(
    Math.min(grossSubtotal, Math.max(0, input.deductibleCredit)),
  )
  const afterCredit = round2(grossSubtotal - deductibleCredit)
  const depositApplied = round2(
    Math.min(afterCredit, Math.max(0, input.depositCents) / 100),
  )
  const invoiceDiscount = round2(deductibleCredit + depositApplied)

  return {
    version: RESTORATION_BILLING_SNAPSHOT_VERSION,
    projectId: input.projectId,
    customerId: input.customerId,
    serviceDate: input.serviceDate,
    serviceAddress: input.serviceAddress,
    closedAt: input.closedAt,
    charges: input.charges.map((charge) => ({ ...charge })),
    grossSubtotal,
    deductibleCredit,
    depositApplied,
    invoiceDiscount,
    amountDue: round2(grossSubtotal - invoiceDiscount),
    refundDueCents: Math.max(0, Math.round(input.refundDueCents)),
  }
}

export function isMonthlyRestorationSnapshot(
  value: unknown,
): value is MonthlyRestorationSnapshot {
  if (!value || typeof value !== 'object') return false
  const snapshot = value as Partial<MonthlyRestorationSnapshot>
  return (
    snapshot.version === RESTORATION_BILLING_SNAPSHOT_VERSION &&
    typeof snapshot.projectId === 'string' &&
    typeof snapshot.customerId === 'string' &&
    typeof snapshot.serviceDate === 'string' &&
    Array.isArray(snapshot.charges) &&
    typeof snapshot.grossSubtotal === 'number' &&
    typeof snapshot.invoiceDiscount === 'number' &&
    typeof snapshot.amountDue === 'number'
  )
}

export function reconcileBatchAmounts(input: {
  appointmentSubtotals: number[]
  restorationSnapshots: MonthlyRestorationSnapshot[]
}): { subtotal: number; discountAmount: number; total: number } {
  const subtotal = round2(
    input.appointmentSubtotals.reduce((sum, value) => sum + Number(value), 0) +
      input.restorationSnapshots.reduce(
        (sum, snapshot) => sum + snapshot.grossSubtotal,
        0,
      ),
  )
  const discountAmount = round2(
    input.restorationSnapshots.reduce(
      (sum, snapshot) => sum + snapshot.invoiceDiscount,
      0,
    ),
  )
  return {
    subtotal,
    discountAmount,
    total: round2(Math.max(0, subtotal - discountAmount)),
  }
}

export function reportSha256(buffer: Uint8Array): string {
  return createHash('sha256').update(buffer).digest('hex')
}

export function restorationReportStoragePath(params: {
  customerId: string
  projectId: string
  version?: number
}): string {
  return `${params.customerId}/${params.projectId}/final-v${params.version ?? RESTORATION_REPORT_VERSION}.pdf`
}
