// @vitest-environment node
import { config as loadEnv } from 'dotenv'
import { describe, it, expect } from 'vitest'

loadEnv({ path: '.env.local' })

import { buildForwardNumberElements } from './forward-numbers'
import { getCallRoutingConfig } from './call-routing-config'

describe('buildForwardNumberElements', () => {
  it('rings both phones when primary + secondary are set', () => {
    const out = buildForwardNumberElements({
      primaryForwardNumber: '+17206447577',
      secondaryForwardNumber: '+17197498807',
    })
    expect(out).toContain('<Number>+17206447577</Number>')
    expect(out).toContain('<Number>+17197498807</Number>')
    expect(out.match(/<Number>/g)).toHaveLength(2)
  })

  it('rings only the primary when no secondary is set', () => {
    const out = buildForwardNumberElements({
      primaryForwardNumber: '+17206447577',
      secondaryForwardNumber: '',
    })
    expect(out).toBe('<Number>+17206447577</Number>')
  })

  it('dedupes identical numbers (failover === primary)', () => {
    const out = buildForwardNumberElements({
      primaryForwardNumber: '+17206447577',
      secondaryForwardNumber: '+17206447577',
    })
    expect(out.match(/<Number>/g)).toHaveLength(1)
  })

  it('drops invalid/empty numbers', () => {
    const out = buildForwardNumberElements({
      primaryForwardNumber: '+17206447577',
      secondaryForwardNumber: 'not-a-number',
    })
    expect(out).toBe('<Number>+17206447577</Number>')
  })
})

describe('getCallRoutingConfig against the real DB', () => {
  it('loads the secondary forward number from phone_settings', async () => {
    const config = await getCallRoutingConfig()
    // Both forward numbers should be E.164 (or secondary empty if unset).
    expect(config.primaryForwardNumber).toMatch(/^\+\d{8,}$/)
    if (config.secondaryForwardNumber) {
      expect(config.secondaryForwardNumber).toMatch(/^\+\d{8,}$/)
      // When both are present, the dial element must ring both.
      const dial = buildForwardNumberElements(config)
      expect(dial.match(/<Number>/g)?.length).toBeGreaterThanOrEqual(2)
    }
  })
})
