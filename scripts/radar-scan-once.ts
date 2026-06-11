/** One-off Radar scan runner for local verification. Usage: npx tsx scripts/radar-scan-once.ts */
import { config } from 'dotenv'
config({ path: '.env.local' })

async function main() {
  const m = await import('../src/lib/radar-scan')
  const result = await m.runRadarScan()
  console.log(JSON.stringify(result))
}
main().catch((e) => {
  console.error(e)
  process.exit(1)
})
