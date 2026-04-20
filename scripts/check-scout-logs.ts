#!/usr/bin/env tsx
import { config } from 'dotenv'
import { createClient } from '@supabase/supabase-js'

config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

async function main() {
  console.log('Checking recent Scout conversations...\n')

  // Check for recent Scout chat sessions
  const { data: sessions, error } = await supabase
    .from('chat_sessions')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(10)

  if (error) {
    console.error('Error:', error)
    process.exit(1)
  }

  if (!sessions || sessions.length === 0) {
    console.log('No chat sessions found')
    return
  }

  console.log(`Found ${sessions.length} recent chat sessions:\n`)

  for (const session of sessions) {
    const created = new Date(session.created_at).toLocaleString()
    console.log(`Session ID: ${session.id}`)
    console.log(`Created: ${created}`)
    console.log(`Metadata:`, JSON.stringify(session.metadata || {}, null, 2))
    console.log('---\n')
  }

  // Also check for any error logs in the last 24 hours
  console.log('\nChecking for Scout API errors...')

  const yesterday = new Date()
  yesterday.setDate(yesterday.getDate() - 1)

  // This would need an error logging table if it exists
  console.log('(Error logging table not found - would need to be set up)')
}

main()
