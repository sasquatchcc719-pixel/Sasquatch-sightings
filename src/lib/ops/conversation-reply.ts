import type { SupabaseClient } from '@supabase/supabase-js'
import { sendCustomerSMSWithResult } from '@/lib/twilio'

type SendSms = typeof sendCustomerSMSWithResult

export async function sendConversationReply(params: {
  supabase: SupabaseClient
  conversationId: string
  message: string
  sentBy: string
  mediaIds?: string[]
  sendSms?: SendSms
}) {
  const message = params.message.trim()
  if (!message) throw new Error('Message is required')

  const { data: conversation, error: conversationError } = await params.supabase
    .from('conversations')
    .select('id, phone_number, lead_id, ops_customer_id, messages, status')
    .eq('id', params.conversationId)
    .maybeSingle()
  if (conversationError) throw conversationError
  if (!conversation) throw new Error('Conversation not found')

  const mediaIds = Array.from(new Set(params.mediaIds || []))
  if (mediaIds.length > 5)
    throw new Error('A reply may include at most 5 files')

  let mediaUrls: string[] = []
  let attachedMedia: Array<{
    id: string
    content_type: string
    category: string
  }> = []
  if (mediaIds.length > 0) {
    const { data: media, error: mediaError } = await params.supabase
      .from('ops_customer_media')
      .select(
        'id, conversation_id, storage_path, content_type, category, status',
      )
      .in('id', mediaIds)
      .eq('conversation_id', params.conversationId)
      .eq('status', 'available')
    if (mediaError) throw mediaError
    if ((media || []).length !== mediaIds.length) {
      throw new Error(
        'Every attachment must be an available file from this conversation',
      )
    }
    attachedMedia = (media || []).map((row) => ({
      id: row.id,
      content_type: row.content_type,
      category: row.category,
    }))
    const signed = await Promise.all(
      (media || []).map((row) =>
        params.supabase.storage
          .from('customer-media')
          .createSignedUrl(row.storage_path, 10 * 60),
      ),
    )
    mediaUrls = signed.map((result) => result.data?.signedUrl || '')
    if (mediaUrls.some((url) => !url)) {
      throw new Error('One or more attachments could not be authorized')
    }
  }

  const { data: relayThread, error: relayError } = await params.supabase
    .from('telegram_relay_threads')
    .select('business_number')
    .eq('phone', conversation.phone_number)
    .maybeSingle()
  if (relayError) throw relayError

  const sendSms = params.sendSms ?? sendCustomerSMSWithResult
  const sent = await sendSms(
    conversation.phone_number,
    message,
    conversation.lead_id || undefined,
    mediaUrls.length > 0 ? 'admin_mms_reply' : 'admin_reply',
    relayThread?.business_number || undefined,
    {
      sentBy: params.sentBy,
      customerId: conversation.ops_customer_id || undefined,
    },
    mediaUrls,
  )

  const messages = Array.isArray(conversation.messages)
    ? [...conversation.messages]
    : []
  messages.push({
    role: 'assistant',
    content: message,
    timestamp: new Date().toISOString(),
    twilio_sid: sent.sid,
    sent_by: params.sentBy,
    media: attachedMedia,
  })

  const { error: updateError } = await params.supabase
    .from('conversations')
    .update({
      messages,
      status:
        conversation.status === 'completed' ? 'active' : conversation.status,
      updated_at: new Date().toISOString(),
    })
    .eq('id', params.conversationId)
  if (updateError) {
    console.error(
      '[conversation-reply] SMS/MMS sent but history update failed:',
      updateError,
    )
  }

  return {
    conversation_id: params.conversationId,
    twilio_sid: sent.sid,
    to: sent.to,
    from: sent.from,
    media_count: attachedMedia.length,
    history_recorded: !updateError,
    warning: updateError
      ? 'Twilio accepted the message, but Sightings history could not be updated. Check Twilio before retrying.'
      : null,
  }
}
