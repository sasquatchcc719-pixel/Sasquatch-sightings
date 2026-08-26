// @vitest-environment node
import { config as loadEnv } from 'dotenv'
import { describe, it, expect } from 'vitest'

loadEnv({ path: '.env.local' })

import { getForwardNumbers } from './forward-numbers'
import { getCallRoutingConfig } from './call-routing-config'

describe('getForwardNumbers', () => {
  it('returns the primary phone before the secondary phone', () => {
    const out = getForwardNumbers({
      primaryForwardNumber: '+17206447577',
      secondaryForwardNumber: '+17197498807',
    })
    expect(out).toEqual(['+17206447577', '+17197498807'])
  })

  it('rings only the primary when no secondary is set', () => {
    const out = getForwardNumbers({
      primaryForwardNumber: '+17206447577',
      secondaryForwardNumber: '',
    })
    expect(out).toEqual(['+17206447577'])
  })

  it('dedupes identical numbers (failover === primary)', () => {
    const out = getForwardNumbers({
      primaryForwardNumber: '+17206447577',
      secondaryForwardNumber: '+17206447577',
    })
    expect(out).toEqual(['+17206447577'])
  })

  it('drops invalid/empty numbers', () => {
    const out = getForwardNumbers({
      primaryForwardNumber: '+17206447577',
      secondaryForwardNumber: 'not-a-number',
    })
    expect(out).toEqual(['+17206447577'])
  })
})

describe('getCallRoutingConfig against the real DB', () => {
  it('loads the secondary forward number from phone_settings', async () => {
    const config = await getCallRoutingConfig()
    // Both forward numbers should be E.164 (or secondary empty if unset).
    expect(config.primaryForwardNumber).toMatch(/^\+\d{8,}$/)
    if (config.secondaryForwardNumber) {
      expect(config.secondaryForwardNumber).toMatch(/^\+\d{8,}$/)
      expect(getForwardNumbers(config)).toEqual([
        config.primaryForwardNumber,
        config.secondaryForwardNumber,
      ])
    }
  })
})
