import { config } from 'dotenv'
import { createClient } from '@supabase/supabase-js'

config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

async function checkHarryActivity() {
  // Check recent AI chat logs (last 6 hours)
  const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString()

  console.log('\n=== RECENT HARRY CONVERSATIONS (last 6 hours) ===\n')

  // Get all recent sessions
  const { data: sessions, error: sessionsError } = await supabase
    .from('ai_chat_logs')
    .select('session_id, from_identity, created_at, agent, channel')
    .eq('agent', 'harry')
    .gte('created_at', sixHoursAgo)
    .order('created_at', { ascending: false })

  if (sessionsError) {
    console.error('Error:', sessionsError)
    return
  }

  // Group by session
  const sessionMap = new Map<string, any[]>()
  sessions?.forEach((log) => {
    if (!sessionMap.has(log.session_id)) {
      sessionMap.set(log.session_id, [])
    }
    sessionMap.get(log.session_id)!.push(log)
  })

  console.log(`Found ${sessionMap.size} conversation session(s)\n`)

  // For each session, get the full conversation
  for (const [sessionId, logs] of sessionMap.entries()) {
    const firstLog = logs[logs.length - 1]
    console.log(`\n📱 ${firstLog.from_identity}`)
    console.log(`   Session: ${sessionId}`)
    console.log(`   Channel: ${firstLog.channel}`)
    console.log(`   Started: ${new Date(firstLog.created_at).toLocaleString()}`)

    // Get full conversation for this session
    const { data: messages } = await supabase
      .from('ai_chat_logs')
      .select('role, content, created_at')
      .eq('session_id', sessionId)
      .order('created_at', { ascending: true })
      .limit(20)

    if (messages && messages.length > 0) {
      console.log(`   Messages (${messages.length} total):\n`)
      messages.forEach((msg, idx) => {
        const time = new Date(msg.created_at).toLocaleTimeString()
        const preview = (msg.content || '').slice(0, 100).replace(/\n/g, ' ')
        console.log(
          `   ${idx + 1}. [${time}] ${msg.role.toUpperCase()}: ${preview}${msg.content && msg.content.length > 100 ? '...' : ''}`,
        )
      })
    }

    // Check for errors/tool failures
    const { data: toolCalls } = await supabase
      .from('ai_tool_calls')
      .select('tool_name, success, error, created_at')
      .eq('session_id', sessionId)
      .order('created_at', { ascending: false })
      .limit(10)

    if (toolCalls && toolCalls.length > 0) {
      console.log(`\n   Tool Calls:`)
      toolCalls.forEach((tool) => {
        const status = tool.success ? '✓' : '✗'
        console.log(
          `     ${status} ${tool.tool_name}${tool.error ? ` - ERROR: ${tool.error}` : ''}`,
        )
      })
    }

    console.log('\n' + '─'.repeat(80))
  }

  // Also check recent appointments
  console.log('\n\n=== RECENT APPOINTMENTS (last 24 hours) ===\n')

  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

  const { data: appts } = await supabase
    .from('ops_appointments')
    .select(
      `
      id,
      appointment_date,
      lead_source,
      created_at,
      status,
      ops_customers!ops_appointments_customer_id_fkey (
        full_name,
        phone
      ),
      ops_invoices (
        total,
        status
      )
    `,
    )
    .gte('created_at', oneDayAgo)
    .order('created_at', { ascending: false })

  appts?.forEach((appt) => {
    const customer = Array.isArray(appt.ops_customers)
      ? appt.ops_customers[0]
      : appt.ops_customers
    const invoice = Array.isArray(appt.ops_invoices)
      ? appt.ops_invoices[0]
      : appt.ops_invoices

    console.log(`${customer?.full_name} - ${customer?.phone}`)
    console.log(`  Lead Source: ${appt.lead_source || 'Not specified'}`)
    console.log(`  Appointment: ${appt.appointment_date}`)
    console.log(`  Created: ${new Date(appt.created_at).toLocaleString()}`)
    console.log(`  Status: ${appt.status}`)
    if (invoice) {
      console.log(`  Invoice Total: $${invoice.total}`)
    }
    console.log(``)
  })
}

checkHarryActivity()
