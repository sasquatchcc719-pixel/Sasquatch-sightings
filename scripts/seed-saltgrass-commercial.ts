/** Initialize a private draft from the accepted bid. Never publishes, sends, signs, or schedules. */
import { config } from 'dotenv'
config({ path: '.env.local' })
import { createClient } from '@supabase/supabase-js'
import { contentFromEstimate } from '../src/lib/ops/commercial-server'

async function main() {
  const db = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  )
  const customerId = 'bb862cbe-d3a8-4f87-a17c-7b00e54903b6'
  const estimateId = '4859863a-8983-4ec0-89bf-dadf034b5349'
  const { data: existing, error: existingError } = await db
    .from('ops_commercial_agreements')
    .select('id,status')
    .eq('customer_id', customerId)
    .eq('source_estimate_id', estimateId)
    .limit(1)
  if (existingError) throw existingError
  if (existing?.length) {
    console.log(
      'Saltgrass agreement already exists; preserved:',
      existing[0].id,
    )
    return
  }
  const content = await contentFromEstimate(db, customerId, estimateId)
  content.title = 'Saltgrass — Initial Cleaning & Maintenance Options'
  content.lines = content.lines.map((line) => ({
    ...line,
    area:
      line.unit === 'per_sq_ft' ? 'Measured carpet areas' : 'Tables and chairs',
    method:
      line.unit === 'per_sq_ft'
        ? 'Initial restorative carpet clean with heavy agitation and appropriate soil treatment'
        : 'Move tables and chairs where required',
    service_window: 'To be confirmed with the restaurant',
  }))
  const carpet = content.lines.find((line) => line.unit === 'per_sq_ft')!
  // These are documented alternatives in the accepted estimate's notes, not an agreed recurring commitment.
  content.lines.push({
    ...carpet,
    id: crypto.randomUUID(),
    name: 'Maintenance — hot water extraction',
    phase: 'optional',
    unit_price: 0.35,
    method: 'Truck-mounted hot water extraction',
    frequency: 'On request; evaluate after initial cleaning',
    notes:
      'Rate discussed in the accepted estimate. Timing and number of visits remain to be agreed.',
  })
  content.lines.push({
    ...carpet,
    id: crypto.randomUUID(),
    name: 'Maintenance — low moisture cleaning',
    phase: 'optional',
    unit_price: 0.28,
    method: 'Very low moisture (VLM) cleaning',
    frequency:
      'Trial after initial cleaning; maintenance frequency to be agreed',
    notes:
      'Rate discussed in the accepted estimate. Evaluate performance after the oil buildup is addressed before committing to a recurring program.',
  })
  const { data, error } = await db
    .from('ops_commercial_agreements')
    .insert({
      customer_id: customerId,
      source_estimate_id: estimateId,
      content,
    })
    .select('id,status')
    .single()
  if (error) throw error
  console.log('Private Saltgrass draft created:', data.id, data.status)
}
main().catch((error) => {
  console.error(error.message)
  process.exitCode = 1
})
