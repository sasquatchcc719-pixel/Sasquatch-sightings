// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  parseProfitAndLossCost,
  type QbReportRow,
} from './quickbooks-profit-loss'

const section = (
  label: string,
  total: number,
  children: QbReportRow[] = [],
): QbReportRow => ({
  Header: { ColData: [{ value: label }] },
  Summary: { ColData: [{ value: `Total ${label}` }, { value: `${total}` }] },
  Rows: { Row: children },
})

describe('parseProfitAndLossCost', () => {
  it('uses only P&L cost sections and removes reconciliation discrepancies', () => {
    const result = parseProfitAndLossCost([
      section('Income', 50000),
      section('Cost of Goods Sold', 1000, [section('Materials', 1000)]),
      section('Expenses', 12000, [
        section('Payroll expenses', 8000),
        section('Advertising & marketing', 4000),
      ]),
      section('Other Expenses', 2800, [
        section('Vehicle expenses', 3000),
        section('Reconciliation Discrepancies', -200),
      ]),
      section('Net Income', 34200),
    ])

    expect(result).toEqual({
      costOfGoodsSold: 1000,
      operatingExpenses: 12000,
      otherExpenses: 2800,
      reconciliationDiscrepancies: -200,
      operatingCost: 16000,
      expenseBreakdown: {
        Materials: 1000,
        'Payroll expenses': 8000,
        'Advertising & marketing': 4000,
        'Vehicle expenses': 3000,
        'Reconciliation Discrepancies': -200,
      },
    })
  })
})
