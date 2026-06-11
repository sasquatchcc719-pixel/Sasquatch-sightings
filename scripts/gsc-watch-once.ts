/** One-off GSC watch run (seeds baseline + sends real digest). Usage: npx tsx scripts/gsc-watch-once.ts */
import { config } from 'dotenv'
config({ path: '.env.local' })

async function main() {
  const { createAdminClient } = await import('../src/supabase/server')
  const { runGscWatch } = await import('../src/lib/gsc-watch')
  const result = await runGscWatch(createAdminClient())
  const { digest, ...stats } = result
  console.log(JSON.stringify(stats, null, 1))
  console.log('\n--- digest sent to Telegram ---\n' + digest)
}
main().catch((e) => {
  console.error(e)
  process.exit(1)
})
