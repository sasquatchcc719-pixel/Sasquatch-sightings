import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'

config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// 1. Find Patricia in ops_customers
const { data: customers, error: custErr } = await supabase
  .from('ops_customers')
  .select('id, full_name, phone, email, ops_service_addresses(*)')
  .ilike('full_name', '%patricia%foxworthy%')

if (custErr) { console.error('Customer lookup error:', custErr); process.exit(1) }
if (!customers?.length) {
  console.log('No customer found matching "Patricia Foxworthy". Trying first name only...')
  const { data: c2 } = await supabase
    .from('ops_customers')
    .select('id, full_name, phone, email, ops_service_addresses(*)')
    .ilike('full_name', '%patricia%')
  console.log('Partial matches:', JSON.stringify(c2, null, 2))
  process.exit(0)
}

const customer = customers[0]
console.log('\n=== CUSTOMER ===')
console.log(`ID:    ${customer.id}`)
console.log(`Name:  ${customer.full_name}`)
console.log(`Phone: ${customer.phone}`)
console.log(`Email: ${customer.email}`)
console.log('\n=== CURRENT ADDRESSES ===')
customer.ops_service_addresses.forEach((a, i) => {
  console.log(`[${i}] id=${a.id}`)
  console.log(`    ${a.label}`)
  console.log(`    ${a.street_1}${a.street_2 ? ', ' + a.street_2 : ''}`)
  console.log(`    ${a.city}, ${a.state} ${a.zip_code}`)
  if (a.gate_code) console.log(`    Gate: ${a.gate_code}`)
})

// 2. Find all conversations for her phone number
const phone = customer.phone?.replace(/\D/g, '')
const e164 = phone?.length === 10 ? `+1${phone}` : phone?.startsWith('1') ? `+${phone}` : customer.phone

console.log(`\n=== CONVERSATIONS (phone: ${e164}) ===`)
const { data: convos, error: convoErr } = await supabase
  .from('conversations')
  .select('id, source, status, created_at, updated_at, messages')
  .eq('phone_number', e164)
  .order('updated_at', { ascending: false })

if (convoErr) { console.error('Conversation error:', convoErr); process.exit(1) }
if (!convos?.length) {
  console.log('No conversations found for this phone number.')
  process.exit(0)
}

convos.forEach((convo, ci) => {
  console.log(`\n--- Conversation ${ci + 1} (source: ${convo.source}, status: ${convo.status}) ---`)
  console.log(`Updated: ${new Date(convo.updated_at).toLocaleString()}`)
  const msgs = Array.isArray(convo.messages) ? convo.messages : []
  msgs.forEach((msg, mi) => {
    const time = new Date(msg.timestamp).toLocaleString()
    const role = msg.role === 'user' ? 'PATRICIA' : 'US'
    console.log(`  [${mi + 1}] ${time} — ${role}:`)
    console.log(`       ${msg.content}`)
  })
})

// 3. Check her upcoming appointments
console.log('\n=== UPCOMING APPOINTMENTS ===')
const { data: appts } = await supabase
  .from('ops_appointments')
  .select('id, appointment_date, start_time, status, ops_service_addresses(street_1, city, state, zip_code)')
  .eq('customer_id', customer.id)
  .gte('appointment_date', new Date().toISOString().slice(0, 10))
  .order('appointment_date')

if (!appts?.length) {
  console.log('No upcoming appointments.')
} else {
  appts.forEach(a => {
    const addr = Array.isArray(a.ops_service_addresses) ? a.ops_service_addresses[0] : a.ops_service_addresses
    console.log(`  ${a.appointment_date} ${a.start_time?.slice(0,5)} — ${a.status}`)
    if (addr) console.log(`  Address: ${addr.street_1}, ${addr.city}, ${addr.state} ${addr.zip_code}`)
    console.log(`  Appointment ID: ${a.id}`)
  })
}
