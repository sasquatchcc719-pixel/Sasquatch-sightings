// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  classifyMarketingExpense,
  marketingExpenseLines,
  type QBExpenseLine,
} from './quickbooks-expenses'

function expense(overrides: Partial<QBExpenseLine>): QBExpenseLine {
  return {
    key: 'Purchase:1:0',
    txnId: '1',
    entity: 'Purchase',
    date: '2026-07-15',
    amount: 100,
    account: 'Office expenses:Software & apps',
    vendor: '',
    memo: '',
    ...overrides,
  }
}

describe('QuickBooks marketing expense classification', () => {
  it('includes every expense QuickBooks posts to a marketing account', () => {
    expect(
      classifyMarketingExpense(
        expense({
          account: 'Advertising & marketing',
          vendor: 'Unrecognized merchant',
        }),
      ),
    ).toBe('Other marketing')
    expect(
      classifyMarketingExpense(
        expense({ account: 'Office expenses:Printing & photocopying' }),
      ),
    ).toBe('Print, mail & signage')
  })

  it('recovers known marketing vendors from the wrong QuickBooks account', () => {
    expect(
      classifyMarketingExpense(
        expense({ account: 'Meals', memo: 'META PLATFORMS charge' }),
      ),
    ).toBe('Facebook / Meta')
    expect(
      classifyMarketingExpense(
        expense({
          vendor: 'Nextdoor',
          account: 'Office expenses:Software & apps',
        }),
      ),
    ).toBe('Nextdoor')
    expect(
      classifyMarketingExpense(expense({ vendor: 'Inkferno Creative' })),
    ).toBe('Vehicle wraps')
  })

  it('uses the most specific category before generic marketing fallbacks', () => {
    expect(
      classifyMarketingExpense(
        expense({
          account: 'Advertising & marketing:Website ads',
          memo: 'GOOGLE ADS',
        }),
      ),
    ).toBe('Google ads')
  })

  it('does not treat unrelated operating expenses as marketing', () => {
    expect(
      classifyMarketingExpense(
        expense({ account: 'Supplies & materials', vendor: 'Jon-Don' }),
      ),
    ).toBeNull()
  })

  it('returns only classified lines and keeps their source identity', () => {
    const rows = marketingExpenseLines([
      expense({ key: 'Purchase:1:0', vendor: 'Nextdoor' }),
      expense({ key: 'Purchase:2:0', vendor: 'Jon-Don' }),
    ])
    expect(rows).toEqual([
      expect.objectContaining({
        key: 'Purchase:1:0',
        channel: 'Nextdoor',
      }),
    ])
  })
})
