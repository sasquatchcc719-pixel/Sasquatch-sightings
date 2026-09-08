import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parse } from 'dotenv'
import { createClient } from '@supabase/supabase-js'
import twilio from 'twilio'
import {
  applyCallHistoryRepair,
  planCallHistoryRepair,
} from '../src/lib/twilio/call-history'

async function main() {
  const env = parse(readFileSync('.env.vercel.production'))
  const db = createClient(
    env.NEXT_PUBLIC_SUPABASE_URL.trim(),
    env.SUPABASE_SERVICE_ROLE_KEY.trim(),
    { auth: { persistSession: false } },
  )
  const client = twilio(
    env.TWILIO_ACCOUNT_SID.trim(),
    env.TWILIO_AUTH_TOKEN.trim(),
  )
  const plan = await planCallHistoryRepair(
    db,
    client,
    env.TWILIO_PHONE_NUMBER.trim(),
  )
  mkdirSync('output', { recursive: true })
  const backup = resolve(`output/call-history-repair-${Date.now()}.json`)
  writeFileSync(backup, JSON.stringify(plan, null, 2), { mode: 0o600 })
  console.log(
    JSON.stringify(
      {
        backup,
        existing: plan.existing.length,
        changes: plan.changes.length,
        unavailable: plan.unavailable,
        active: plan.active,
        transitions: plan.changes.reduce<Record<string, number>>(
          (counts, c) => {
            const key = `${c.before?.outcome ?? 'missing'} -> ${c.values.outcome}`
            counts[key] = (counts[key] ?? 0) + 1
            return counts
          },
          {},
        ),
      },
      null,
      2,
    ),
  )
  if (process.argv.includes('--apply'))
    console.log(await applyCallHistoryRepair(db, plan))
}
main().catch((error) => {
  console.error(error.message)
  process.exitCode = 1
})
