// @vitest-environment node
/**
 * createQBInvoice writes to QuickBooks and only then does the caller record
 * the id. A worker killed between those two statements leaves the invoice in
 * QuickBooks with nothing here pointing at it, so the next run re-creates it
 * and QBO refuses the DocNumber. That is how invoice #18453 blocked the whole
 * sync queue for two days and #18696 sat in QuickBooks reading "failed".
 */
import { describe, it, expect } from 'vitest'
import { adoptDuplicateInvoiceId } from '@/lib/quickbooks-api'

// The exact body QuickBooks returned for Jill Benns's flood invoice.
const REAL = `{"Fault":{"Error":[{"Message":"Duplicate Document Number Error","Detail":"Duplicate Document Number Error : You must specify a different number. This number has already been used. DocNumber=18696 is assigned to TxnType=Invoice with TxnId=6575","code":"6140","element":""}],"type":"ValidationFault"},"time":"2026-09-01T19:27:51.208-07:00"}`

describe('adopting a duplicate QuickBooks invoice', () => {
  it('recovers the id from the real fault that broke invoice 18696', () => {
    expect(adoptDuplicateInvoiceId(REAL, 18696)).toBe('6575')
  })

  it('accepts the doc number as a string too', () => {
    expect(adoptDuplicateInvoiceId(REAL, '18696')).toBe('6575')
  })

  it('refuses to adopt when the fault names a different invoice', () => {
    // Guards against silently linking our row to somebody else's transaction.
    expect(adoptDuplicateInvoiceId(REAL, 18697)).toBeNull()
  })

  it('does not match on a prefix of our number', () => {
    expect(adoptDuplicateInvoiceId(REAL, 1869)).toBeNull()
  })

  it('returns null on an unrelated failure', () => {
    expect(
      adoptDuplicateInvoiceId('{"Fault":{"Error":[{"code":"500"}]}}', 18696),
    ).toBeNull()
  })
})
