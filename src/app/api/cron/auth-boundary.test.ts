// @vitest-environment node
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
const effects = vi.hoisted(() => vi.fn())
vi.mock('@/lib/ops/drip-campaign', () => ({ processDripEmails: effects }))
import { GET } from './drip-emails/route'
describe('cron authentication boundary', () => {
  it('all cron handlers require a configured secret before comparing a bearer token', () => {
    for (const entry of readdirSync(join(process.cwd(), 'src/app/api/cron'), {
      withFileTypes: true,
    }).filter((entry) => entry.isDirectory())) {
      const source = readFileSync(
        join(process.cwd(), 'src/app/api/cron', entry.name, 'route.ts'),
        'utf8',
      )
      expect(source, entry.name).toMatch(/!process\.env\.CRON_SECRET|!secret/)
    }
  })
  it.each([undefined, ''])(
    'rejects Bearer undefined/empty configuration without campaign work: %s',
    async (secret) => {
      vi.stubEnv('CRON_SECRET', secret)
      const response = await GET(
        new NextRequest('https://example.test/api/cron/drip-emails', {
          headers: { authorization: `Bearer ${secret}` },
        }),
      )
      expect(response.status).toBe(401)
      expect(effects).not.toHaveBeenCalled()
      vi.unstubAllEnvs()
    },
  )
})
