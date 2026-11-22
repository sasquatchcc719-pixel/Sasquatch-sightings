// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { lookupPhoneCaller, recognizePhoneCaller } from './caller'

const phone = '+15555550100'
const customer = {
  id: '7a8751fa-b464-4911-991c-05d848ada531',
  first_name: 'Jo',
  last_name: 'Rivera',
  email: 'private@example.org',
  business_name: null,
}
const address = {
  id: '31d29174-a3e6-4567-8714-d2ccd3f89108',
  street_1: '123 Oak Lane',
  street_2: 'Apartment 2',
  city: 'Monument',
  state: 'CO',
  zip_code: '80132',
}
const provided = {
  first_name: 'Jo',
  last_name: 'Rivera',
  street: '123 Oak Ln',
  unit: '2',
}

function db(customers: object[], addresses: object[]) {
  const from = vi.fn((table: string) => {
    const result = {
      error: null,
      data: table === 'ops_customers' ? customers : addresses,
    }
    const query = {
      select: vi.fn(() => query),
      in: vi.fn(() => query),
      eq: vi.fn(() => query),
      order: vi.fn(() => query),
      limit: vi.fn(() => ({
        ...result,
        abortSignal: vi.fn().mockResolvedValue(result),
      })),
    }
    return query
  })
  return { client: { from } as unknown as SupabaseClient, from }
}

describe('phone caller verification', () => {
  it('recognizes only the presence of a prior record at greeting time', async () => {
    const { client, from } = db([customer], [])
    expect(
      await recognizePhoneCaller(phone, client, new AbortController().signal),
    ).toBe(true)
    expect(from.mock.results[0].value.select).toHaveBeenCalledWith('id')
  })
  it('resolves caller-supplied name, exact street and unit, returning only a ZIP and references for that location', async () => {
    const { client } = db(
      [customer],
      [address, { ...address, id: '42', street_1: '900 Private Rd' }],
    )
    const result = await lookupPhoneCaller(phone, provided, client)
    expect(result).toMatchObject({
      status: 'verified_location',
      customer_ref: customer.id,
      service_address_ref: address.id,
      zip_code: '80132',
      saved_email_available: true,
    })
    expect(JSON.stringify(result)).not.toMatch(
      /private|Rivera|Oak Lane|Apartment/,
    )
  })
  it.each([
    ['wrong last name', { ...provided, last_name: 'Other' }, [customer]],
    [
      'guessing only the first name',
      { ...provided, last_name: '' },
      [customer],
    ],
    [
      'unverified address',
      { ...provided, street: '123 Different Lane' },
      [customer],
    ],
    ['missing unit', { ...provided, unit: undefined }, [customer]],
    ['another unit', { ...provided, unit: '3' }, [customer]],
    ['shared number', provided, [customer, { ...customer, id: 'other' }]],
    ['unknown caller', provided, []],
  ])('does not reveal any saved details for %s', async (_, details, rows) => {
    const { client } = db(rows as object[], [address])
    expect(
      await lookupPhoneCaller(phone, details as typeof provided, client),
    ).toEqual({ status: 'no_verified_location', guidance: expect.any(String) })
  })
})
