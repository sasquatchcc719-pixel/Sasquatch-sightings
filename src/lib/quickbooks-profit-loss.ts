import { getValidQBAccessToken } from '@/lib/quickbooks-auth'

const BASE = 'https://quickbooks.api.intuit.com/v3/company'

type QbColumn = { value?: string }

export type QbReportRow = {
  Header?: { ColData?: QbColumn[] }
  Summary?: { ColData?: QbColumn[] }
  ColData?: QbColumn[]
  Rows?: { Row?: QbReportRow[] }
}

export type ProfitAndLossCost = {
  costOfGoodsSold: number
  operatingExpenses: number
  otherExpenses: number
  reconciliationDiscrepancies: number
  operatingCost: number
  expenseBreakdown: Record<string, number>
}

const round2 = (value: number) =>
  Math.round((value + Number.EPSILON) * 100) / 100

function rowLabel(row: QbReportRow): string {
  return (
    row.Header?.ColData?.[0]?.value ||
    row.ColData?.[0]?.value ||
    row.Summary?.ColData?.[0]?.value ||
    ''
  )
}

function rowAmount(row: QbReportRow): number {
  return Number(
    row.Summary?.ColData?.[1]?.value || row.ColData?.[1]?.value || 0,
  )
}

function directBreakdown(row: QbReportRow): Record<string, number> {
  return Object.fromEntries(
    (row.Rows?.Row || [])
      .map((child) => [rowLabel(child), round2(rowAmount(child))] as const)
      .filter(([label]) => Boolean(label)),
  )
}

function mergeBreakdowns(
  ...breakdowns: Array<Record<string, number>>
): Record<string, number> {
  const merged: Record<string, number> = {}
  for (const breakdown of breakdowns) {
    for (const [label, amount] of Object.entries(breakdown)) {
      merged[label] = round2((merged[label] || 0) + amount)
    }
  }
  return merged
}

function findAmount(rows: QbReportRow[], label: string): number {
  for (const row of rows) {
    if (rowLabel(row) === label) return rowAmount(row)
    const nested = findAmount(row.Rows?.Row || [], label)
    if (nested !== 0) return nested
  }
  return 0
}

export function parseProfitAndLossCost(rows: QbReportRow[]): ProfitAndLossCost {
  const cogsRow = rows.find((row) => rowLabel(row) === 'Cost of Goods Sold')
  const expensesRow = rows.find((row) => rowLabel(row) === 'Expenses')
  const otherExpensesRow = rows.find(
    (row) => rowLabel(row) === 'Other Expenses',
  )
  const costOfGoodsSold = rowAmount(cogsRow || {})
  const operatingExpenses = rowAmount(expensesRow || {})
  const otherExpenses = rowAmount(otherExpensesRow || {})
  const reconciliationDiscrepancies = findAmount(
    otherExpensesRow?.Rows?.Row || [],
    'Reconciliation Discrepancies',
  )

  return {
    costOfGoodsSold: round2(costOfGoodsSold),
    operatingExpenses: round2(operatingExpenses),
    otherExpenses: round2(otherExpenses),
    reconciliationDiscrepancies: round2(reconciliationDiscrepancies),
    operatingCost: round2(
      costOfGoodsSold +
        operatingExpenses +
        otherExpenses -
        reconciliationDiscrepancies,
    ),
    expenseBreakdown: mergeBreakdowns(
      directBreakdown(cogsRow || {}),
      directBreakdown(expensesRow || {}),
      directBreakdown(otherExpensesRow || {}),
    ),
  }
}

export async function loadProfitAndLossCost(params: {
  startDate: string
  endDate: string
}): Promise<ProfitAndLossCost> {
  const auth = await getValidQBAccessToken()
  if (!auth) throw new Error('QuickBooks is not connected')

  const search = new URLSearchParams({
    start_date: params.startDate,
    end_date: params.endDate,
    accounting_method: 'Cash',
    minorversion: '75',
  })
  const response = await fetch(
    `${BASE}/${auth.realmId}/reports/ProfitAndLoss?${search}`,
    {
      headers: {
        Authorization: `Bearer ${auth.accessToken}`,
        Accept: 'application/json',
      },
    },
  )
  const text = await response.text()
  if (!response.ok) {
    throw new Error(`QuickBooks P&L ${response.status}: ${text.slice(0, 300)}`)
  }
  const report = JSON.parse(text) as { Rows?: { Row?: QbReportRow[] } }
  return parseProfitAndLossCost(report.Rows?.Row || [])
}
