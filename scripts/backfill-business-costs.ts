import 'dotenv/config'
import {
  BUSINESS_COST_HISTORY_START,
  refreshBusinessCostSnapshots,
  rollingCostWindowsSince,
} from '../src/lib/ops/business-economics'
import { createAdminClient } from '../src/supabase/server'

async function main() {
  const windows = rollingCostWindowsSince(BUSINESS_COST_HISTORY_START)
  const snapshots = await refreshBusinessCostSnapshots(
    createAdminClient(),
    windows,
  )
  const latest = snapshots.at(-1)
  console.log(
    JSON.stringify(
      {
        windows: snapshots.length,
        first: snapshots[0]?.windowEnd || null,
        latest: latest?.windowEnd || null,
        latestRevenuePerHour: latest?.revenuePerHour || null,
        latestBookCostPerHour: latest?.bookCostPerHour || null,
        latestOwnerAdjustedCostPerHour:
          latest?.ownerAdjustedCostPerHour || null,
      },
      null,
      2,
    ),
  )
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
