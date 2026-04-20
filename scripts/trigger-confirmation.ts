#!/usr/bin/env tsx
import { config } from 'dotenv'
config({ path: '.env.local' })

import { sendOpsLifecycleCommunications } from '../src/lib/ops/communications'
import { syncAppointmentToQuickBooks } from '../src/lib/quickbooks-api'

async function main() {
  const appointmentId = process.argv[2]
  if (!appointmentId) {
    console.error(
      'Usage: npx tsx scripts/trigger-confirmation.ts <appointment-id>',
    )
    process.exit(1)
  }

  console.log(`Sending confirmation for appointment ${appointmentId}...`)

  try {
    // Send customer confirmations (email + SMS)
    const result = await sendOpsLifecycleCommunications({
      event: 'job_scheduled',
      appointmentId,
    })

    console.log(`✅ Sent ${result.sent.length} confirmation(s):`)
    for (const notification of result.sent) {
      console.log(`  - ${notification.channel}: ${notification.destination}`)
    }

    // Sync to QuickBooks
    console.log('\nSyncing to QuickBooks...')
    await syncAppointmentToQuickBooks(appointmentId)
    console.log('✅ QuickBooks sync queued')
  } catch (error) {
    console.error('Error:', error)
    process.exit(1)
  }
}

main()
