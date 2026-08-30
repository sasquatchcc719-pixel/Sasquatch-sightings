import { describe, expect, it } from 'vitest'
import { deriveCustomerName } from './resolve-customer'

describe('deriveCustomerName', () => {
  it('keeps an explicit full name and the parts given with it', () => {
    expect(
      deriveCustomerName({ full_name: 'Jill Andersen', first_name: 'Jill', last_name: 'Andersen' }),
    ).toEqual({ fullName: 'Jill Andersen', firstName: 'Jill', lastName: 'Andersen' })
  })

  it('builds a full name from the parts', () => {
    expect(deriveCustomerName({ first_name: 'Jill', last_name: 'Andersen' }).fullName).toBe(
      'Jill Andersen',
    )
  })

  it('splits a single typed name, which is all you get on a panicked call', () => {
    expect(deriveCustomerName({ full_name: 'Jill Andersen' })).toEqual({
      fullName: 'Jill Andersen',
      firstName: 'Jill',
      lastName: 'Andersen',
    })
  })

  it('handles a one-word name without inventing a surname', () => {
    expect(deriveCustomerName({ full_name: 'Jill' })).toEqual({
      fullName: 'Jill',
      firstName: 'Jill',
      lastName: '',
    })
  })

  it('handles a multi-part surname', () => {
    expect(deriveCustomerName({ full_name: 'Ana Maria de la Cruz' })).toMatchObject({
      firstName: 'Ana',
      lastName: 'Maria de la Cruz',
    })
  })

  it('returns empty rather than throwing on nothing', () => {
    expect(deriveCustomerName({})).toEqual({ fullName: '', firstName: '', lastName: '' })
  })
})

describe('phone validation', () => {
  // normalizeOpsPhone('') returns '+', which is truthy. Anything short of a real
  // number must be rejected before it is normalised, or a customer with no phone
  // matches every other record stored with that same junk value.
  it.each(['', '   ', '+', '555', 'call back', '(719) 55'])(
    'rejects %j as a phone number',
    async (phone) => {
      const { resolveOrCreateCustomer } = await import('./resolve-customer')
      const result = await resolveOrCreateCustomer(
        // The client is never reached: validation happens first.
        null as never,
        { customer: { full_name: 'Someone', phone } },
      )
      expect(result).toEqual({ ok: false, error: 'customer phone is required' })
    },
  )
})
