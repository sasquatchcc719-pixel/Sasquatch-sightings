#!/usr/bin/env tsx
import { config } from 'dotenv'
import { createClient } from '@supabase/supabase-js'

config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

async function main() {
  console.log('Checking Scout chat logs for recent activity...\n')

  // Get recent Scout logs
  const { data: logs, error } = await supabase
    .from('ai_chat_logs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(20)

  if (error) {
    console.error('Error:', error)
    process.exit(1)
  }

  if (!logs || logs.length === 0) {
    console.log('No chat logs found')
    return
  }

  console.log(`Found ${logs.length} recent chat messages:\n`)

  // Group by session_id
  const sessions = new Map<string, any[]>()
  for (const log of logs) {
    const sid = log.session_id || 'unknown'
    if (!sessions.has(sid)) {
      sessions.set(sid, [])
    }
    sessions.get(sid)!.push(log)
  }

  for (const [sessionId, msgs] of sessions) {
    const firstMsg = msgs[msgs.length - 1]
    const created = new Date(firstMsg.created_at).toLocaleString()

    console.log(`\n═══ Session: ${sessionId.slice(0, 8)}... ═══`)
    console.log(`Started: ${created}`)
    console.log(`Messages: ${msgs.length}`)

    // Look for tool calls and errors
    const toolCalls = msgs.filter((m) => m.tool_name)
    const errors = msgs.filter(
      (m) => m.error_message || (m.content && m.content.includes('error')),
    )

    if (toolCalls.length > 0) {
      console.log(`\nTool calls:`)
      for (const tc of toolCalls) {
        console.log(
          `  - ${tc.tool_name}: ${tc.tool_result ? 'Success' : 'Failed'}`,
        )
        if (tc.tool_result && tc.tool_result.includes('error')) {
          console.log(`    Error: ${tc.tool_result.slice(0, 100)}...`)
        }
      }
    }

    if (errors.length > 0) {
      console.log(`\n⚠️  Errors in this session:`)
      for (const err of errors) {
        console.log(`  ${err.error_message || err.content?.slice(0, 100)}`)
      }
    }
  }
}

main()
