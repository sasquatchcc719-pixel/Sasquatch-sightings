// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { lookupPhoneCaller } from './caller'

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
  customer_id: customer.id,
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
  const second = { ...customer, id: '7a8751fa-b464-4911-991c-05d848ada532' }
  const otherAddress = {
    ...address,
    id: '31d29174-a3e6-4567-8714-d2ccd3f89109',
    customer_id: second.id,
  }
  it('resolves equivalent same-name, same-address, same-email duplicates behind other household records', async () => {
    const { client } = db(
      [
        { ...customer, id: 'other', first_name: 'Other' },
        customer,
        { ...second, email: 'PRIVATE@example.org' },
      ],
      [
        otherAddress,
        address,
        { ...address, id: 'another', street_1: '123 Oak Ln.' },
      ],
    )
    expect(await lookupPhoneCaller(phone, provided, client)).toMatchObject({
      status: 'verified_location',
      customer_ref: customer.id,
      service_address_ref: address.id,
      saved_email_available: true,
    })
  })
  it('asks for a caller-supplied email only when verified locations lead to different mailboxes', async () => {
    const { client } = db(
      [customer, { ...second, email: 'different@example.org' }],
      [address, otherAddress],
    )
    const unresolved = await lookupPhoneCaller(phone, provided, client)
    expect(unresolved.status).toBe('needs_email_confirmation')
    expect(JSON.stringify(unresolved)).not.toContain('@')
    expect(
      await lookupPhoneCaller(
        phone,
        { ...provided, email: 'DIFFERENT@example.org' },
        client,
      ),
    ).toMatchObject({
      customer_ref: second.id,
      service_address_ref: otherAddress.id,
    })
    expect(
      (
        await lookupPhoneCaller(
          phone,
          { ...provided, email: 'wrong@example.org' },
          client,
        )
      ).status,
    ).toBe('no_verified_location')
  })
  it('asks for ZIP when identical streets are in different towns and matches the supplied ZIP', async () => {
    const { client } = db(
      [customer, second],
      [
        address,
        { ...otherAddress, zip_code: '80903', city: 'Colorado Springs' },
      ],
    )
    expect((await lookupPhoneCaller(phone, provided, client)).status).toBe(
      'needs_location_confirmation',
    )
    expect(
      await lookupPhoneCaller(
        phone,
        { ...provided, zip_code: '80903' },
        client,
      ),
    ).toMatchObject({ customer_ref: second.id })
  })
  it('distinguishes a shared ZIP by the city the caller supplied', async () => {
    const { client } = db(
      [customer, second],
      [address, { ...otherAddress, city: 'Another City' }],
    )
    expect(
      (
        await lookupPhoneCaller(
          phone,
          { ...provided, zip_code: address.zip_code },
          client,
        )
      ).status,
    ).toBe('needs_location_confirmation')
    expect(
      await lookupPhoneCaller(
        phone,
        { ...provided, city: address.city, zip_code: address.zip_code },
        client,
      ),
    ).toMatchObject({ customer_ref: customer.id })
  })
  it('keeps personal and commercial profiles separate on a shared number', async () => {
    const { client } = db(
      [customer, { ...second, business_name: 'Sample Business' }],
      [address, otherAddress],
    )
    expect(await lookupPhoneCaller(phone, provided, client)).toMatchObject({
      customer_ref: customer.id,
    })
    expect(
      await lookupPhoneCaller(
        phone,
        { ...provided, business_name: 'Sample Business' },
        client,
      ),
    ).toMatchObject({ customer_ref: second.id })
  })
  it('asks for fresh contact information for an imported placeholder email', async () => {
    const { client } = db(
      [{ ...customer, email: 'unknown@import.local' }],
      [address],
    )
    expect(await lookupPhoneCaller(phone, provided, client)).toMatchObject({
      saved_email_available: false,
      guidance: expect.stringContaining('spell'),
    })
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
    [
      'wrong company',
      { ...provided, business_name: 'Other Business' },
      [customer],
    ],
    ['unknown caller', provided, []],
  ])('does not reveal any saved details for %s', async (_, details, rows) => {
    const { client } = db(rows as object[], [address])
    expect(
      await lookupPhoneCaller(phone, details as typeof provided, client),
    ).toEqual({ status: 'no_verified_location', guidance: expect.any(String) })
  })
})
