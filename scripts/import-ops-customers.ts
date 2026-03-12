import fs from 'node:fs/promises'
import path from 'node:path'
import dotenv from 'dotenv'
import { createAdminClient } from '@/supabase/server'
import { importOpsCustomersFromCsv } from '@/lib/ops/customer-import'

async function main() {
  dotenv.config({ path: '.env.local' })
  const targetPath = process.argv[2]
  if (!targetPath) {
    throw new Error(
      'Usage: pnpm tsx scripts/import-ops-customers.ts "/absolute/path/to/customers.csv"',
    )
  }

  const absolutePath = path.resolve(targetPath)
  const csvText = await fs.readFile(absolutePath, 'utf8')

  const supabase = createAdminClient()
  const result = await importOpsCustomersFromCsv({ csvText, supabase })

  console.log('Customer import complete:')
  console.log(JSON.stringify(result, null, 2))
}

main().catch((error) => {
  console.error('Customer import failed:', error)
  process.exit(1)
})
