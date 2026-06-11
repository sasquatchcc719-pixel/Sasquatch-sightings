/** One-off GBP review sync/backfill. Usage: npx tsx scripts/gbp-reviews-sync-once.ts */
import { config } from 'dotenv'
config({ path: '.env.local' })

async function main() {
  const { createAdminClient } = await import('../src/supabase/server')
  const { syncGbpReviews } = await import('../src/lib/gbp-reviews')
  const supabase = createAdminClient()
  const first = await syncGbpReviews(supabase)
  console.log(
    'first run:',
    first.newReviews.length,
    'new | total on Google:',
    first.totalOnGoogle,
  )
  const second = await syncGbpReviews(supabase)
  console.log('second run (incremental):', second.newReviews.length, 'new')
}
main().catch((e) => {
  console.error(e)
  process.exit(1)
})
