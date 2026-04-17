import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'

config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const { data: convos } = await supabase
  .from('conversations')
  .select('id, phone_number, source, status, created_at, updated_at, messages, metadata')
  .order('created_at', { ascending: true })

for (const c of convos) {
  const msgs = Array.isArray(c.messages) ? c.messages : []
  console.log('\n\n╔══════════════════════════════════════════════════════════════════════')
  console.log(`║ CONVO ${c.id}`)
  console.log(`║ phone=${c.phone_number}  source=${c.source}  status=${c.status}`)
  console.log(`║ created=${c.created_at}  updated=${c.updated_at}`)
  console.log(`║ msgs=${msgs.length}  metadata=${JSON.stringify(c.metadata || {})}`)
  console.log('╚══════════════════════════════════════════════════════════════════════')

  // Dedupe: each Harry msg seems to appear twice (outbox + record). Collapse.
  const seen = new Set()
  for (const m of msgs) {
    const key = `${m.role}|${m.content}`
    if (seen.has(key) && m.role === 'assistant') continue
    seen.add(key)
    const tag = m.role === 'user' ? 'CUST' : m.role === 'assistant' ? 'HARRY' : m.role.toUpperCase()
    const ts = m.timestamp ? new Date(m.timestamp).toLocaleString() : ''
    const text = (m.content || '').replace(/\n/g, '\n           ')
    console.log(`\n  [${ts}] ${tag}:`)
    console.log(`    ${text}`)
  }
}
