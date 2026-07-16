import { createAdminClient } from '@/supabase/server'
import { ConversationsView } from '@/components/admin/conversations-view'
import { getCustomerContextForConversations } from '@/lib/ops/conversation-customer-context'

interface PageProps {
  searchParams: Promise<{ source?: string }>
}

export default async function ConversationsPage({ searchParams }: PageProps) {
  const params = await searchParams
  const source = params.source
  const supabase = createAdminClient()

  // Fetch all conversations with linked lead info
  // admin_read_at and ops_customer_id are used for unread badges and Harry silence logic
  let query = supabase
    .from('conversations')
    .select(
      `
      *,
      lead:leads(id, name, source, status)
    `,
    )
    .order('updated_at', { ascending: false })

  const { data: allConversations, error } = await query

  if (error) {
    console.error('Error fetching conversations:', error)
  }

  // Filter by source if specified
  // conversation.source: 'inbound' = direct texts | 'NFC Card' = vendor | 'Business Card' | 'Contest' | 'Google LSA' | 'Yelp'
  let conversations = allConversations || []
  if (source === 'vendor') {
    // Vendor funnel: NFC cards at vendor locations (higher intent, no contest)
    conversations = conversations.filter(
      (c) => c.source === 'NFC Card' || c.source === 'nfc_card',
    )
  } else if (source === 'contest') {
    // Contest funnel: truck/contest (sightings, "spotted the truck", etc.)
    conversations = conversations.filter((c) => c.source === 'Contest')
  } else if (source === 'phone') {
    // Direct SMS: people who texted your business number directly (no NFC/contest context)
    conversations = conversations.filter((c) => c.source === 'inbound')
  } else if (source === 'ai_chats') {
    // All AI-initiated chats: vendor + business card + contest (everything except inbound)
    conversations = conversations.filter(
      (c) =>
        c.source &&
        c.source !== 'inbound' &&
        ['NFC Card', 'nfc_card', 'Business Card', 'Contest'].includes(c.source),
    )
  } else if (source === 'lsa') {
    // Google Local Services Ads inbound leads
    conversations = conversations.filter(
      (c) => c.source === 'Google LSA' || c.source === 'lsa',
    )
  } else if (source === 'yelp') {
    // Yelp inbound messages (integration pending)
    conversations = conversations.filter((c) => c.source === 'Yelp')
  }

  // Attach private MMS media to the exact Twilio message that delivered it.
  // Signed URLs keep customer photos off the public storage surface.
  const conversationIds = conversations.map((c) => c.id as string)
  if (conversationIds.length > 0) {
    const { data: mediaRows, error: mediaError } = await supabase
      .from('ops_customer_media')
      .select(
        'id, conversation_id, customer_id, appointment_id, job_photo_id, twilio_message_sid, storage_path, content_type, status, category, error_message, created_at',
      )
      .in('conversation_id', conversationIds)
      .order('created_at', { ascending: true })

    if (mediaError) {
      console.error('Error fetching conversation media:', mediaError)
    } else {
      const signedMedia = await Promise.all(
        (mediaRows || []).map(async (row) => {
          let signedUrl: string | null = null
          if (row.status === 'available' && row.storage_path) {
            const { data } = await supabase.storage
              .from('customer-media')
              .createSignedUrl(row.storage_path, 60 * 60)
            signedUrl = data?.signedUrl || null
          }
          return {
            id: row.id,
            conversationId: row.conversation_id,
            customerId: row.customer_id,
            appointmentId: row.appointment_id,
            jobPhotoId: row.job_photo_id,
            twilioMessageSid: row.twilio_message_sid,
            contentType: row.content_type,
            status: row.status,
            category: row.category,
            errorMessage: row.error_message,
            createdAt: row.created_at,
            signedUrl,
          }
        }),
      )
      const mediaByConversationAndMessage = new Map<
        string,
        typeof signedMedia
      >()
      for (const item of signedMedia) {
        const key = `${item.conversationId}:${item.twilioMessageSid}`
        const existing = mediaByConversationAndMessage.get(key) || []
        existing.push(item)
        mediaByConversationAndMessage.set(key, existing)
      }

      conversations = conversations.map((conversation) => ({
        ...conversation,
        messages: Array.isArray(conversation.messages)
          ? conversation.messages.map(
              (
                message: Record<string, unknown> & { twilio_sid?: unknown },
              ) => ({
                ...message,
                media:
                  mediaByConversationAndMessage.get(
                    `${conversation.id}:${String(message.twilio_sid || '')}`,
                  ) || [],
              }),
            )
          : [],
      }))
    }
  }

  // Enrich scheduled-customer threads with name/email/address/latest invoice so
  // each card shows full customer context with clickable links.
  const customerContextById = await getCustomerContextForConversations(
    supabase,
    conversations.map((c) => c.ops_customer_id),
  )
  conversations = conversations.map((c) => ({
    ...c,
    customerContext: c.ops_customer_id
      ? (customerContextById.get(c.ops_customer_id) ?? null)
      : null,
  }))

  const isVendorView = source === 'vendor'
  const isContestView = source === 'contest'
  const isPhoneView = source === 'phone'
  const isAIChatsView = source === 'ai_chats'
  const isLsaView = source === 'lsa'
  const isYelpView = source === 'yelp'
  const title = isVendorView
    ? 'Vendor AI Chats'
    : isContestView
      ? 'Contest Chats'
      : isPhoneView
        ? 'Direct Texts'
        : isAIChatsView
          ? 'AI Chats (All)'
          : isLsaView
            ? 'Google LSA'
            : isYelpView
              ? 'Yelp'
              : 'All Conversations'
  const subtitle = isVendorView
    ? 'Texts from people who tapped a vendor NFC card (higher-intent funnel)'
    : isContestView
      ? 'Texts from truck/contest (sightings, "spotted the truck")'
      : isPhoneView
        ? 'Texts from people who contacted your number directly'
        : isAIChatsView
          ? 'Texts from NFC card taps & contest (vendor, business card, contest)'
          : isLsaView
            ? 'Inbound leads from Google Local Services Ads'
            : isYelpView
              ? 'Yelp inbound messages — integration coming soon'
              : 'All SMS conversations – use Marketing or Calls dropdown to filter by source'

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">{title}</h1>
        <p className="text-muted-foreground">{subtitle}</p>
      </div>

      <ConversationsView conversations={conversations} />
    </div>
  )
}
