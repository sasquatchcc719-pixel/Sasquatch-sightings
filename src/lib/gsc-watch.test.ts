// @vitest-environment node
/**
 * Integration test for the weekly GSC watch — real Search Console API and
 * real DB, with a tiny target list and an injected notifier (no Telegram).
 * Snapshot rows created during the test are removed afterward.
 */
import { config as loadEnv } from 'dotenv'
import { describe, it, expect, afterAll } from 'vitest'

loadEnv({ path: '.env.local' })

import { createAdminClient } from '@/supabase/server'
import { runGscWatch } from './gsc-watch'
import { GSC_WWW_PROPERTY, fetchSitemapUrls } from './gsc'

describe('GSC weekly watch against real API + DB', () => {
  const supabase = createAdminClient()
  const testStart = new Date().toISOString()

  afterAll(async () => {
    await supabase
      .from('gsc_page_snapshots')
      .delete()
      .gte('checked_at', testStart)
  })

  it('fetchSitemapUrls reads the live marketing sitemap', async () => {
    const urls = await fetchSitemapUrls(
      'https://www.sasquatchcarpet.com/sitemap.xml',
    )
    expect(urls.length).toBeGreaterThan(30)
    expect(urls).toContain(
      'https://www.sasquatchcarpet.com/service-areas/monument',
    )
  })

  it(
    'inspects, snapshots, and produces a digest',
    { timeout: 90_000 },
    async () => {
      const notices: string[] = []
      const result = await runGscWatch(supabase, {
        notifyOwner: async (text) => {
          notices.push(text)
        },
        targets: [
          {
            property: GSC_WWW_PROPERTY,
            url: 'https://www.sasquatchcarpet.com/',
          },
          {
            property: GSC_WWW_PROPERTY,
            url: 'https://www.sasquatchcarpet.com/service-areas/monument',
          },
          {
            property: GSC_WWW_PROPERTY,
            url: 'https://www.sasquatchcarpet.com/carpet-cleaning-rockrimmon-colorado-springs',
          },
        ],
      })

      expect(result.inspected).toBe(3)
      // Homepage + Rockrimmon are verified-indexed pages as of 2026-06-11.
      expect(result.indexed).toBeGreaterThanOrEqual(1)
      expect(notices).toHaveLength(1)
      expect(notices[0]).toContain('GSC Weekly Watch')
      expect(notices[0]).toContain('Index coverage')

      const { data: rows } = await supabase
        .from('gsc_page_snapshots')
        .select('url, coverage')
        .gte('checked_at', testStart)
      expect((rows || []).length).toBe(3)
    },
  )
})
