/**
 * Run the GBP review watchdog once.
 * Usage: npx tsx scripts/gbp-review-sync-once.ts [--alert]
 *
 * Alerts are OFF by default so a manual run can't spam Telegram. The very first
 * run stamps the already-known missing reviews silently; after that, the daily
 * cron only fires on genuinely new disappearances.
 */
import { config } from 'dotenv'
config({ path: '.env.local' })

async function main() {
  const alert = process.argv.includes('--alert')
  const { createAdminClient } = await import('../src/supabase/server')
  const { syncGbpReviews } = await import('../src/lib/ops/gbp-review-sync')

  const r = await syncGbpReviews(createAdminClient(), { alert })

  console.log('--- GBP review sync ---')
  console.log('displayed count :', r.aggregateCount)
  console.log('reviews returned:', r.returnedCount)
  console.log('count mismatch  :', r.countMismatch)
  console.log('inserted        :', r.inserted)
  console.log('updated         :', r.updated)
  console.log('reappeared      :', r.reappeared.length)
  console.log('newly missing   :', r.newlyMissing.length)
  for (const m of r.newlyMissing) {
    console.log(`   - ${m.author ?? 'Unknown'}: ${(m.text ?? '').slice(0, 60)}`)
  }
  console.log('alert sent      :', r.alerted)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
