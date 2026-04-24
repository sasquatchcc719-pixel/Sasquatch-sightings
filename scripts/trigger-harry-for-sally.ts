/**
 * Trigger Harry to send initial outreach to Sally Rhoades
 */
import { createClient } from '@supabase/supabase-js'
import twilio from 'twilio'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
const twilioSid = process.env.TWILIO_ACCOUNT_SID!
const twilioToken = process.env.TWILIO_AUTH_TOKEN!
const twilioPhone = process.env.TWILIO_PHONE_NUMBER!

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing Supabase credentials')
  process.exit(1)
}

if (!twilioSid || !twilioToken || !twilioPhone) {
  console.error('Missing Twilio credentials')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseServiceKey)
const twilioClient = twilio(twilioSid, twilioToken)

async function triggerHarryForSally() {
  const phone = '+17194813646'
  const conversationId = 'f371ca3d-73fa-4958-97ce-1ad9c638ee68'

  console.log('📱 Triggering Harry to reach out to Sally...\n')

  // Get the conversation
  const { data: conversation, error: convError } = await supabase
    .from('conversations')
    .select('messages')
    .eq('id', conversationId)
    .single()

  if (convError || !conversation) {
    console.error('❌ Error loading conversation:', convError)
    return
  }

  // Craft Harry's first message
  const harryMessage = `Hi Sally! I saw your inquiry about carpet cleaning at 2445 Ledgewood Dr. That's quite a project - 5 bedrooms, closet, stairs, great room, and dealing with cat damage.

I'd love to help you get a quote scheduled. A few quick questions:

1. What kind of cat damage are we looking at? (stains, odor, or both?)
2. Any specific areas that need extra attention?
3. What's your timeline for getting this done?

I can get you a detailed quote and available dates. Just text me back here!

- Harry @ Sasquatch Carpet Cleaning
(719) 249-8791`

  console.log("✏️  Harry's message:")
  console.log('---')
  console.log(harryMessage)
  console.log('---\n')

  // Add Harry's message to the conversation
  const messages =
    (conversation.messages as Array<{
      role: string
      content: string
      timestamp: string
      twilio_sid?: string
    }>) || []

  messages.push({
    role: 'assistant',
    content: harryMessage,
    timestamp: new Date().toISOString(),
  })

  // Send via Twilio
  console.log('📤 Sending SMS via Twilio...')
  try {
    const result = await twilioClient.messages.create({
      body: harryMessage,
      from: twilioPhone,
      to: phone,
    })

    console.log('✅ SMS sent! SID:', result.sid)

    // Update the message with Twilio SID
    messages[messages.length - 1].twilio_sid = result.sid

    // Update conversation
    await supabase
      .from('conversations')
      .update({
        messages,
        updated_at: new Date().toISOString(),
      })
      .eq('id', conversationId)

    console.log("✅ Conversation updated with Harry's response")
    console.log('\n🎯 Sally should receive the text shortly!')
    console.log(
      '   When she replies, Harry will automatically continue the conversation.',
    )
  } catch (twilioError) {
    console.error('❌ Error sending SMS:', twilioError)
  }
}

triggerHarryForSally()
