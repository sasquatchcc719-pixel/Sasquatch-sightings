import { accessSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

// The provider contract, transport/receipt scenario and actual PostgreSQL writer
// are independent release checks. Vitest normally ignores missing path filters.
const required = [
  'src/app/api/phone-assistant/incoming/live.test.ts',
  'scripts/phone-tests/booking-receipt.test.ts',
  'scripts/phone-tests/booking-sql.test.ts',
  'src/lib/ops/phone-booking-email.test.ts',
]
for (const path of required) accessSync(path)

// Vercel builds have live credentials. The release suite exercises fixtures only.
const env = { CI: '1', NODE_ENV: 'test', TZ: 'America/Denver' }
for (const key of ['PATH', 'HOME', 'TMPDIR', 'TMP', 'TEMP', 'SystemRoot']) {
  if (process.env[key]) env[key] = process.env[key]
}
execFileSync(
  process.execPath,
  [
    'node_modules/vitest/vitest.mjs',
    'run',
    '--maxWorkers=2',
    '--minWorkers=1',
    'scripts/phone-tests',
    'src/lib/phone-assistant',
    'src/app/api/phone-assistant',
    'src/app/api/twilio/harry-voice',
    'src/app/api/twilio/ivr-menu',
    'src/lib/mcp/business-operations-appointment.test.ts',
    'src/lib/ops/phone-booking-email.test.ts',
  ],
  { env, stdio: 'inherit' },
)
