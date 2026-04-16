import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

async function bookAnnBiebel() {
  // First, find the service IDs
  const { data: services, error: servicesError } = await supabase
    .from('service_catalog_items')
    .select('id, name, base_price')
    .eq('is_active', true)

  if (servicesError || !services) {
    console.error('Error fetching services:', servicesError)
    return
  }

  // Find the matching services
  const hallService = services.find((s) =>
    s.name.includes('Hall/Bathroom/Closet'),
  )
  const regularRoomService = services.find((s) =>
    s.name.includes('Regular Size Room'),
  )
  const stepService = services.find((s) => s.name.includes('Step Carpet'))
  const urineService = services.find((s) => s.name.includes('Urine Eliminator'))

  console.log('Found services:')
  console.log('Hall:', hallService)
  console.log('Regular Room:', regularRoomService)
  console.log('Step:', stepService)
  console.log('Urine:', urineService)

  if (!hallService || !regularRoomService || !stepService || !urineService) {
    console.error('Could not find all required services')
    return
  }

  // Create the booking payload
  const payload = {
    customer: {
      first_name: 'Ann',
      last_name: 'Biebel',
      email: 'abiebel@comcast.net',
      phone: '+17203193352',
    },
    address: {
      street_1: '4242 Miners Candle Place',
      city: 'Castle Rock',
      state: 'CO',
      zip_code: '80109',
    },
    line_items: [
      {
        service_catalog_item_id: hallService.id,
        name_snapshot: hallService.name,
        quantity: 3,
        unit_price: 25,
        duration_minutes: 60,
      },
      {
        service_catalog_item_id: regularRoomService.id,
        name_snapshot: regularRoomService.name,
        quantity: 2,
        unit_price: 46,
        duration_minutes: 60,
      },
      {
        service_catalog_item_id: stepService.id,
        name_snapshot: stepService.name,
        quantity: 15,
        unit_price: 4,
        duration_minutes: 30,
      },
      {
        service_catalog_item_id: urineService.id,
        name_snapshot: urineService.name,
        quantity: 4,
        unit_price: 25,
        duration_minutes: 30,
      },
    ],
    appointment: {
      appointment_date: '2026-04-21', // Monday April 21 (not 20 - 4/20 is Sunday)
      start_time: '11:00:00',
    },
    promo_code: null,
  }

  // Call the booking API
  const response = await fetch(
    'https://sightings.sasquatchcarpet.com/api/public/appointments',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-booking-secret':
          'sqtch_bkg_8c183378fd38b30c14ef5712461e247619b62543d1e2c601',
      },
      body: JSON.stringify(payload),
    },
  )

  const result = await response.json()

  if (response.ok) {
    console.log('✅ Booking created successfully!')
    console.log('Confirmation:', result.confirmation_number)
    console.log('Appointment ID:', result.appointment_id)
    console.log('Total:', result.total)
  } else {
    console.error('❌ Booking failed:', result)
  }
}

bookAnnBiebel()
