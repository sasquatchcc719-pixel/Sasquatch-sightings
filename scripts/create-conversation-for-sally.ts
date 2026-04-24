/**
 * Create a conversation for Sally Rhoades from old system inquiry
 */
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing Supabase credentials')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseServiceKey)

async function createSallyConversation() {
  const phone = '+17194813646'
  const name = 'Sally Rhoades'
  const email = 'yukonkitty@gmail.com'
  const message = `Service: Carpet Cleaning
Address: 2445 Ledgewood Dr
Message: 5 bedrooms, closet, stairs, great room
Cat damage`

  console.log('Creating conversation for Sally Rhoades...\n')

  // Check if conversation exists
  const { data: existing } = await supabase
    .from('conversations')
    .select('id, messages')
    .eq('phone_number', phone)
    .maybeSingle()

  if (existing) {
    console.log('📝 Conversation already exists:', existing.id)
    console.log('Adding new message to existing conversation...\n')

    const messages =
      (existing.messages as Array<{
        role: string
        content: string
        timestamp: string
      }>) || []

    messages.push({
      role: 'user',
      content: message,
      timestamp: new Date().toISOString(),
    })

    await supabase
      .from('conversations')
      .update({
        messages,
        updated_at: new Date().toISOString(),
      })
      .eq('id', existing.id)

    console.log('✅ Message added to conversation:', existing.id)
    console.log('\nHarry will see this new message and can respond.')
    return
  }

  // Create new conversation
  const { data: newConv, error } = await supabase
    .from('conversations')
    .insert({
      phone_number: phone,
      source: 'inbound',
      messages: [
        {
          role: 'user',
          content: message,
          timestamp: new Date().toISOString(),
        },
      ],
      ai_enabled: true,
      status: 'active',
    })
    .select('id')
    .single()

  if (error) {
    console.error('❌ Error creating conversation:', error)
    return
  }

  console.log('✅ Created conversation:', newConv.id)
  console.log('\n👤 Customer Details:')
  console.log('   Name:', name)
  console.log('   Phone:', phone)
  console.log('   Email:', email)
  console.log('\n📋 Inquiry:')
  console.log('  ', message.split('\n').join('\n   '))
  console.log('\n🤖 Harry is enabled and will respond automatically')
  console.log('   View at: /admin/conversations')
}

createSallyConversation()
