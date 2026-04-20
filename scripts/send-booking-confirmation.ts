#!/usr/bin/env tsx
import { config } from 'dotenv'

config({ path: '.env.local' })

async function sendConfirmation(appointmentId: string) {
  const baseUrl =
    process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(
      'supabase.co',
      'vercel.app',
    )?.replace('//', '//sasquatch-sightings.') || 'http://localhost:3000'

  console.log(`Triggering confirmation for appointment ${appointmentId}...`)

  const response = await fetch(
    `${baseUrl}/api/admin/ops/appointments/${appointmentId}/send-confirmation`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
    },
  )

  if (!response.ok) {
    console.error('Failed to trigger confirmation:', await response.text())
    // Try lifecycle communications directly
    console.log('Trying lifecycle communications endpoint...')

    const lifecycleResponse = await fetch(
      `${baseUrl}/api/internal/send-lifecycle`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event: 'job_scheduled',
          appointmentId,
        }),
      },
    )

    if (lifecycleResponse.ok) {
      console.log('✅ Confirmation sent via lifecycle endpoint')
    } else {
      console.log(
        '⚠️  Could not auto-send confirmation - may need to send manually from admin UI',
      )
    }
    return
  }

  console.log('✅ Confirmation sent')
}

const appointmentId = process.argv[2]
if (!appointmentId) {
  console.error(
    'Usage: npx tsx scripts/send-booking-confirmation.ts <appointment-id>',
  )
  process.exit(1)
}

sendConfirmation(appointmentId)
