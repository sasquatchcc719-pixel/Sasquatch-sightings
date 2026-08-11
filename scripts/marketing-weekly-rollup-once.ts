/** Backfill recent weeks and preview the latest completed digest. */
import { config } from 'dotenv'

config({ path: '.env.local' })

async function main() {
  const { createAdminClient } = await import('../src/supabase/server')
  const {
    buildMarketingRollupDigest,
    completedWeeks,
    refreshMarketingWeeklyRollup,
    weeksThroughCurrent,
  } = await import('../src/lib/ops/marketing-rollup')
  const result = await refreshMarketingWeeklyRollup(createAdminClient(), {
    windows: weeksThroughCurrent(16),
  })
  const latestCompleted = completedWeeks(1)[0]
  const digestRows = result.rows.filter(
    (row) => row.week_start === latestCompleted.start,
  )
  console.log(
    JSON.stringify(
      {
        builtAt: result.builtAt,
        rows: result.rows.length,
        weeks: 16,
      },
      null,
      2,
    ),
  )
  console.log('\n' + buildMarketingRollupDigest(digestRows))
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
