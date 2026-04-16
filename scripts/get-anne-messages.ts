import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

async function getAnneMessages() {
  // First try to find messages mentioning Anne or Castle Rock
  const { data: messages, error } = await supabase
    .from('sms_messages')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(50)

  if (error) {
    console.error('Error:', error)
    return
  }

  // Find Anne's messages
  const anneMessages = messages.filter(
    (m) =>
      m.body?.toLowerCase().includes('anne') ||
      m.body?.toLowerCase().includes('castle rock'),
  )

  console.log('Recent Anne/Castle Rock messages:')
  console.log(JSON.stringify(anneMessages, null, 2))

  // Also check conversations
  const { data: conversations } = await supabase
    .from('conversations')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(10)

  console.log('\n\nRecent conversations:')
  console.log(JSON.stringify(conversations, null, 2))
}

getAnneMessages()
