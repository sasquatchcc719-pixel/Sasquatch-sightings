import { describe, expect, it } from 'vitest'
import { readServiceEditIntent, type IntentModel } from './read-intent'

/** A fake model that always returns the given string. */
function fakeModel(reply: string): IntentModel {
  return async () => reply
}

const jamieServices = [
  'Step Carpet Cleaning (Per Step Charge)',
  'Hall/Bathroom/Closet Carpet cleaning 30 to 100 sqft',
  'Regular Size Room (100 to 200 Sqft)',
  'Urine Eliminator Treatment',
  'Dryer Duct cleaning',
]

describe('readServiceEditIntent', () => {
  it('parses a valid remove_service intent', async () => {
    const result = await readServiceEditIntent({
      customerMessage: "Thanks. I won't need the closet cleaning.",
      currentServices: jamieServices,
      model: fakeModel('{"type":"remove_service","match":"closet"}'),
    })
    expect(result).toEqual({
      status: 'intent',
      intent: { type: 'remove_service', match: 'closet' },
    })
  })

  it('handles JSON wrapped in code fences', async () => {
    const result = await readServiceEditIntent({
      customerMessage: 'drop the dryer duct please',
      currentServices: jamieServices,
      model: fakeModel(
        '```json\n{"type":"remove_service","match":"dryer duct"}\n```',
      ),
    })
    expect(result.status).toBe('intent')
  })

  it('STRIPS any number the model tries to smuggle in', async () => {
    const result = await readServiceEditIntent({
      customerMessage: 'take the closet off',
      currentServices: jamieServices,
      // Model wrongly tries to assert a price — it must not survive.
      model: fakeModel(
        '{"type":"remove_service","match":"closet","price":50,"newTotal":150}',
      ),
    })
    if (result.status !== 'intent') throw new Error('expected intent')
    expect(result.intent).toEqual({ type: 'remove_service', match: 'closet' })
    expect('price' in result.intent).toBe(false)
    expect('newTotal' in result.intent).toBe(false)
  })

  it('returns no_action when the customer is not asking for a service edit', async () => {
    const result = await readServiceEditIntent({
      customerMessage: 'Sounds good, see you then!',
      currentServices: jamieServices,
      model: fakeModel('{"type":"none"}'),
    })
    expect(result.status).toBe('no_action')
  })

  it('rejects (does not guess) on unparseable model output', async () => {
    const result = await readServiceEditIntent({
      customerMessage: 'hmm',
      currentServices: jamieServices,
      model: fakeModel('I think they might want to remove something?'),
    })
    expect(result.status).toBe('unparseable')
  })
})
