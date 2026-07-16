import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
import { resolve } from 'path'

// Load environment variables
config({ path: resolve(process.cwd(), '.env.local') })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function bookAnnBiebel() {
  try {
    console.log('🚀 Starting booking for Ann Biebel...')

    // Customer details
    const firstName = 'Ann'
    const lastName = 'Biebel'
    const fullName = 'Ann Biebel'
    const email = 'abiebel@comcast.net'
    const phone = '+17203193352'
    const street1 = '4242 Miners Candle Place'
    const city = 'Castle Rock'
    const state = 'CO'
    const zipCode = '80109'
    const appointmentDate = '2026-04-21' // Monday April 21
    const startTime = '11:00:00'

    // Line items
    const lineItems = [
      {
        name: 'Small Area / Walk-in Closet (up to 100 sq ft)',
        quantity: 3,
        unitPrice: 25,
        durationMinutes: 60,
      },
      {
        name: 'Regular Size Room (100 to 200 Sqft)',
        quantity: 2,
        unitPrice: 46,
        durationMinutes: 60,
      },
      {
        name: 'Step Carpet Cleaning (Per Step Charge)',
        quantity: 15,
        unitPrice: 4,
        durationMinutes: 30,
      },
      {
        name: 'Urine Eliminator Treatment',
        quantity: 4,
        unitPrice: 25,
        durationMinutes: 30,
      },
    ]

    const subtotal = lineItems.reduce(
      (sum, item) => sum + item.quantity * item.unitPrice,
      0
    )
    const total = subtotal // No discount

    console.log(`💰 Total: $${total}`)

    // Calculate end time (rough estimate: 4 hours)
    const endTime = '15:00:00'

    // Find or create customer
    console.log('👤 Finding/creating customer...')
    let customerId
    const { data: existingCustomer } = await supabase
      .from('ops_customers')
      .select('id')
      .eq('email', email)
      .maybeSingle()

    if (existingCustomer) {
      customerId = existingCustomer.id
      await supabase
        .from('ops_customers')
        .update({
          full_name: fullName,
          first_name: firstName,
          last_name: lastName,
          phone,
          updated_at: new Date().toISOString(),
        })
        .eq('id', customerId)
      console.log(`✅ Updated existing customer: ${customerId}`)
    } else {
      const { data: newCustomer, error: customerError } = await supabase
        .from('ops_customers')
        .insert({
          full_name: fullName,
          first_name: firstName,
          last_name: lastName,
          email,
          phone,
        })
        .select('id')
        .single()

      if (customerError) throw customerError
      customerId = newCustomer.id
      console.log(`✅ Created new customer: ${customerId}`)
    }

    // Find or create service address
    console.log('📍 Finding/creating service address...')
    let addressId
    const { data: existingAddress } = await supabase
      .from('ops_service_addresses')
      .select('id')
      .eq('customer_id', customerId)
      .eq('street_1', street1)
      .eq('zip_code', zipCode)
      .maybeSingle()

    if (existingAddress) {
      addressId = existingAddress.id
      await supabase
        .from('ops_service_addresses')
        .update({ city, state, updated_at: new Date().toISOString() })
        .eq('id', addressId)
      console.log(`✅ Updated existing address: ${addressId}`)
    } else {
      const { data: newAddress, error: addressError } = await supabase
        .from('ops_service_addresses')
        .insert({
          customer_id: customerId,
          street_1: street1,
          city,
          state,
          zip_code: zipCode,
          label: 'Service Address',
        })
        .select('id')
        .single()

      if (addressError) throw addressError
      addressId = newAddress.id
      console.log(`✅ Created new address: ${addressId}`)
    }

    // Create appointment
    console.log('📅 Creating appointment...')
    const { data: appointment, error: appointmentError } = await supabase
      .from('ops_appointments')
      .insert({
        customer_id: customerId,
        service_address_id: addressId,
        appointment_date: appointmentDate,
        start_time: startTime,
        end_time: endTime,
        status: 'booked',
        payment_status: 'unpaid',
        quoted_total: total,
        booking_channel: 'sms_harry',
        source: 'SMS with Harry',
        lead_source: 'SMS - Castle Rock manual booking',
      })
      .select('id')
      .single()

    if (appointmentError) throw appointmentError
    console.log(`✅ Created appointment: ${appointment.id}`)

    // Create invoice
    console.log('💵 Creating invoice...')
    const { data: invoice, error: invoiceError } = await supabase
      .from('ops_invoices')
      .insert({
        appointment_id: appointment.id,
        subtotal: subtotal,
        discount_amount: 0,
        total: total,
        status: 'draft',
        sync_status: 'pending',
      })
      .select('id')
      .single()

    if (invoiceError) throw invoiceError
    console.log(`✅ Created invoice: ${invoice.id}`)

    // Create invoice line items
    console.log('📝 Creating line items...')
    const invoiceLines = lineItems.map((item) => ({
      invoice_id: invoice.id,
      description: item.name,
      quantity: item.quantity,
      unit_price: item.unitPrice,
      line_total: item.quantity * item.unitPrice,
    }))

    const { error: invoiceLinesError } = await supabase
      .from('ops_invoice_line_items')
      .insert(invoiceLines)

    if (invoiceLinesError) throw invoiceLinesError

    // Create appointment line items
    const appointmentLines = lineItems.map((item) => ({
      appointment_id: appointment.id,
      name_snapshot: item.name,
      quantity: item.quantity,
      unit_price: item.unitPrice,
      duration_minutes: item.durationMinutes,
      line_total: item.quantity * item.unitPrice,
    }))

    const { error: appointmentLinesError } = await supabase
      .from('ops_appointment_line_items')
      .insert(appointmentLines)

    if (appointmentLinesError) throw appointmentLinesError
    console.log(`✅ Created ${lineItems.length} line items`)

    // Create status events
    await supabase.from('ops_appointment_status_events').insert({
      appointment_id: appointment.id,
      from_status: null,
      to_status: 'booked',
      notes: 'Appointment created manually for Castle Rock customer (Ann Biebel) - SMS booking via Harry',
    })

    await supabase.from('ops_invoice_status_events').insert({
      invoice_id: invoice.id,
      from_status: null,
      to_status: 'draft',
      notes: 'Invoice created for Castle Rock booking',
    })

    const confirmationNumber = `SC-${appointment.id.slice(0, 8).toUpperCase()}`

    console.log('\n✅ ✅ ✅ BOOKING COMPLETE! ✅ ✅ ✅')
    console.log(`📋 Confirmation: ${confirmationNumber}`)
    console.log(`👤 Customer: ${fullName}`)
    console.log(`📍 Address: ${street1}, ${city}, ${state} ${zipCode}`)
    console.log(`📅 Date: ${appointmentDate} at ${startTime}`)
    console.log(`💰 Total: $${total}`)
    console.log(`🆔 Appointment ID: ${appointment.id}`)
    console.log(`\n🔗 View in admin: https://sightings.sasquatchcarpet.com/admin/operations`)

    return {
      success: true,
      confirmationNumber,
      appointmentId: appointment.id,
      total,
    }
  } catch (error) {
    console.error('❌ ERROR:', error)
    throw error
  }
}

bookAnnBiebel()
