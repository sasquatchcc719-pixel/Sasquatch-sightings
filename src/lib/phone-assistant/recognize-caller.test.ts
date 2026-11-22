// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { recognizePhoneCaller } from './caller'

const number = '+17195550111'
const row = {
  first_name: 'Jordan',
  last_name: 'Rivera',
  full_name: 'Jordan Rivera',
  business_name: null,
}
const signal = new AbortController().signal
function fixture(rows: object[]) {
  const query = {
    select: vi.fn(() => query),
    in: vi.fn(() => query),
    limit: vi.fn(() => query),
    abortSignal: vi.fn().mockResolvedValue({ data: rows, error: null }),
  }
  const from = vi.fn(() => query)
  return { db: { from } as unknown as SupabaseClient, from, query }
}
describe('first-name greeting from CRM', () => {
  it('returns only the first name for a unique caller, with no private email or saved address lookup', async () => {
    const { db, from, query } = fixture([row])
    expect(await recognizePhoneCaller(number, db, signal)).toEqual({
      firstName: 'Jordan',
    })
    expect(from).toHaveBeenCalledWith('ops_customers')
    expect(query.select).toHaveBeenCalledWith(
      'first_name,full_name,last_name,business_name',
    )
  })
  it('recognizes repeated entries with the same unambiguous personal name', async () => {
    const { db } = fixture([row, { ...row, first_name: 'JORDAN' }])
    expect(await recognizePhoneCaller(number, db, signal)).toEqual({
      firstName: 'Jordan',
    })
  })
  it.each([
    [row, { ...row, first_name: 'Jo' }],
    [row, { ...row, last_name: 'Other' }],
    [{ ...row, first_name: 'Customer: 3456' }],
    [{ ...row, business_name: 'Organization' }],
  ])(
    'uses a neutral returning greeting when the matching rows are ambiguous',
    async (...rows) => {
      const { db } = fixture(rows)
      expect(await recognizePhoneCaller(number, db, signal)).toEqual({
        firstName: null,
      })
    },
  )
  it('keeps the general opening for an unseen number', async () => {
    expect(
      await recognizePhoneCaller(number, fixture([]).db, signal),
    ).toBeNull()
  })
  it('does not match international numbers by their last ten digits', async () => {
    const { db, from } = fixture([row])
    expect(await recognizePhoneCaller('+4471995550111', db, signal)).toBeNull()
    expect(from).not.toHaveBeenCalled()
  })
})
