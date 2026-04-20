#!/usr/bin/env tsx
import { config } from 'dotenv'
import { createClient } from '@supabase/supabase-js'

config({ path: '.env.local' })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

const supabase = createClient(supabaseUrl, supabaseKey)

async function approveAppointment(appointmentId: string) {
  console.log(`Approving appointment ${appointmentId}...`)

  // Update appointment status
  const { error: updateError } = await supabase
    .from('ops_appointments')
    .update({ status: 'booked' })
    .eq('id', appointmentId)

  if (updateError) {
    console.error('Error updating appointment:', updateError)
    process.exit(1)
  }

  // Add status event
  const { error: eventError } = await supabase
    .from('ops_appointment_status_events')
    .insert({
      appointment_id: appointmentId,
      from_status: 'pending_approval',
      to_status: 'booked',
      notes: 'Approved by Charles (fixed Monument extended area bug)',
    })

  if (eventError) {
    console.error('Error creating status event:', eventError)
    process.exit(1)
  }

  console.log('✅ Appointment approved and set to "booked" status')
  console.log('Customer will now receive confirmation communications')
}

const appointmentId = process.argv[2]
if (!appointmentId) {
  console.error(
    'Usage: npx tsx scripts/approve-appointment.ts <appointment-id>',
  )
  process.exit(1)
}

approveAppointment(appointmentId)
