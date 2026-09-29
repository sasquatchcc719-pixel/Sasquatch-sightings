import 'server-only'
import { createAdminClient } from '@/supabase/server'
import {
  answerTelegramCallback,
  clearTelegramActionButtons,
  sendTelegramActionMessage,
} from '@/lib/telegram'
import {
  commercialAchTelegramCard,
  isCommercialAchTelegramApprover,
  type CommercialAchAccessStatus,
} from './commercial-ach-approval-shared'

const REQUEST_LIFETIME_MS = 24 * 60 * 60 * 1000
const ACCESS_LIFETIME_MS = 15 * 60 * 1000

type AccessRequestRow = {
  id: string
  customer_id: string
  requested_by_user_id: string
  requested_by_name: string
  requested_by_email: string
  status: CommercialAchAccessStatus
  request_expires_at: string
  access_expires_at: string | null
  telegram_chat_id: number | null
  telegram_message_id: number | null
  revealed_at: string | null
}

export async function requestCommercialAchAccess(params: {
  customerId: string
  userId: string
  requesterName: string
  requesterEmail: string
}) {
  const supabase = createAdminClient()
  const now = new Date()
  const nowIso = now.toISOString()

  const { error: staleRequestError } = await supabase
    .from('commercial_ach_access_requests')
    .update({ status: 'expired', updated_at: nowIso })
    .eq('customer_id', params.customerId)
    .eq('requested_by_user_id', params.userId)
    .eq('status', 'pending')
    .lte('request_expires_at', nowIso)
  if (staleRequestError) throw staleRequestError

  const { data: existingPending, error: pendingError } = await supabase
    .from('commercial_ach_access_requests')
    .select('id,status')
    .eq('customer_id', params.customerId)
    .eq('requested_by_user_id', params.userId)
    .eq('status', 'pending')
    .gt('request_expires_at', nowIso)
    .order('requested_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (pendingError) throw pendingError
  if (existingPending) return existingPending

  const { data: existingApproval, error: approvalError } = await supabase
    .from('commercial_ach_access_requests')
    .select('id,status')
    .eq('customer_id', params.customerId)
    .eq('requested_by_user_id', params.userId)
    .eq('status', 'approved')
    .is('revealed_at', null)
    .gt('access_expires_at', nowIso)
    .order('requested_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (approvalError) throw approvalError
  if (existingApproval) return existingApproval

  const { data: customer, error: customerError } = await supabase
    .from('ops_customers')
    .select('business_name,full_name')
    .eq('id', params.customerId)
    .single()
  if (customerError) throw customerError

  const requestExpiresAt = new Date(
    now.getTime() + REQUEST_LIFETIME_MS,
  ).toISOString()
  const { data: inserted, error: insertError } = await supabase
    .from('commercial_ach_access_requests')
    .insert({
      customer_id: params.customerId,
      requested_by_user_id: params.userId,
      requested_by_name: params.requesterName,
      requested_by_email: params.requesterEmail,
      status: 'pending',
      requested_at: nowIso,
      request_expires_at: requestExpiresAt,
      updated_at: nowIso,
    })
    .select('id,status')
    .single()
  if (insertError) {
    if (insertError.code === '23505') {
      const { data: racedRequest, error: racedRequestError } = await supabase
        .from('commercial_ach_access_requests')
        .select('id,status')
        .eq('customer_id', params.customerId)
        .eq('requested_by_user_id', params.userId)
        .eq('status', 'pending')
        .gt('request_expires_at', nowIso)
        .maybeSingle()
      if (racedRequestError) throw racedRequestError
      if (racedRequest) return racedRequest
    }
    throw insertError
  }

  const card = commercialAchTelegramCard({
    requestId: inserted.id,
    businessName:
      customer.business_name || customer.full_name || 'Commercial customer',
    requesterName: params.requesterName,
    requesterEmail: params.requesterEmail,
    requestedAt: now,
    customerId: params.customerId,
  })
  let telegramMessage = await sendTelegramActionMessage(
    card.message,
    card.buttons,
  )
  if (!telegramMessage) {
    telegramMessage = await sendTelegramActionMessage(
      card.message,
      card.buttons,
    )
  }
  if (!telegramMessage) {
    await supabase
      .from('commercial_ach_access_requests')
      .update({
        status: 'delivery_failed',
        updated_at: new Date().toISOString(),
      })
      .eq('id', inserted.id)
      .eq('status', 'pending')
    throw new Error('Telegram approval request could not be delivered.')
  }

  const { error: telegramUpdateError } = await supabase
    .from('commercial_ach_access_requests')
    .update({
      telegram_chat_id: telegramMessage.chatId,
      telegram_message_id: telegramMessage.messageId,
      updated_at: new Date().toISOString(),
    })
    .eq('id', inserted.id)
    .eq('status', 'pending')
  if (telegramUpdateError) {
    await clearTelegramActionButtons(telegramMessage)
    await supabase
      .from('commercial_ach_access_requests')
      .update({
        status: 'delivery_failed',
        updated_at: new Date().toISOString(),
      })
      .eq('id', inserted.id)
      .eq('status', 'pending')
    throw telegramUpdateError
  }

  return inserted
}

export async function consumeCommercialAchAccess(params: {
  requestId: string
  customerId: string
  userId: string
}): Promise<{ status: CommercialAchAccessStatus | 'not_found' }> {
  const supabase = createAdminClient()
  const nowIso = new Date().toISOString()
  const { data, error } = await supabase
    .from('commercial_ach_access_requests')
    .select(
      'id,customer_id,requested_by_user_id,requested_by_name,requested_by_email,status,request_expires_at,access_expires_at,telegram_chat_id,telegram_message_id,revealed_at',
    )
    .eq('id', params.requestId)
    .eq('customer_id', params.customerId)
    .eq('requested_by_user_id', params.userId)
    .maybeSingle()
  if (error) throw error
  const row = data as AccessRequestRow | null
  if (!row) return { status: 'not_found' }

  if (
    row.status === 'pending' &&
    new Date(row.request_expires_at).getTime() <= Date.now()
  ) {
    await supabase
      .from('commercial_ach_access_requests')
      .update({ status: 'expired', updated_at: nowIso })
      .eq('id', row.id)
      .eq('status', 'pending')
    return { status: 'expired' }
  }
  if (
    row.status === 'approved' &&
    (!row.access_expires_at ||
      new Date(row.access_expires_at).getTime() <= Date.now())
  ) {
    await supabase
      .from('commercial_ach_access_requests')
      .update({ status: 'expired', updated_at: nowIso })
      .eq('id', row.id)
      .eq('status', 'approved')
    return { status: 'expired' }
  }
  if (row.status !== 'approved') return { status: row.status }

  const { data: consumed, error: consumeError } = await supabase
    .from('commercial_ach_access_requests')
    .update({
      status: 'revealed',
      revealed_at: nowIso,
      updated_at: nowIso,
    })
    .eq('id', row.id)
    .eq('customer_id', params.customerId)
    .eq('requested_by_user_id', params.userId)
    .eq('status', 'approved')
    .is('revealed_at', null)
    .gt('access_expires_at', nowIso)
    .select('id')
    .maybeSingle()
  if (consumeError) throw consumeError
  return { status: consumed ? 'approved' : 'revealed' }
}

export async function handleCommercialAchTelegramCallback(params: {
  callbackQueryId: string
  callbackData: string
  userId: number
  chatId: number
  messageId: number
}): Promise<boolean> {
  const match = params.callbackData.match(
    /^ach:(approve|deny):([0-9a-f-]{36})$/i,
  )
  if (!match) return false

  if (!isCommercialAchTelegramApprover(params.userId)) {
    await answerTelegramCallback(
      params.callbackQueryId,
      'This ACH approval is limited to Charles.',
      true,
    )
    return true
  }

  const action = match[1].toLowerCase()
  const requestId = match[2]
  const now = new Date()
  const nowIso = now.toISOString()
  const supabase = createAdminClient()

  try {
    const update =
      action === 'approve'
        ? {
            status: 'approved',
            decided_at: nowIso,
            access_expires_at: new Date(
              now.getTime() + ACCESS_LIFETIME_MS,
            ).toISOString(),
            approved_by_telegram_user_id: params.userId,
            updated_at: nowIso,
          }
        : {
            status: 'denied',
            decided_at: nowIso,
            approved_by_telegram_user_id: params.userId,
            updated_at: nowIso,
          }
    const { data, error } = await supabase
      .from('commercial_ach_access_requests')
      .update(update)
      .eq('id', requestId)
      .eq('status', 'pending')
      .eq('telegram_chat_id', params.chatId)
      .eq('telegram_message_id', params.messageId)
      .gt('request_expires_at', nowIso)
      .select('id')
      .maybeSingle()
    if (error) throw error
    if (!data) {
      await answerTelegramCallback(
        params.callbackQueryId,
        'This request is expired or was already handled.',
        true,
      )
      return true
    }

    await clearTelegramActionButtons(params)
    await answerTelegramCallback(
      params.callbackQueryId,
      action === 'approve'
        ? 'Approved. One reveal is available for 15 minutes.'
        : 'ACH access denied.',
    )
  } catch (error) {
    console.error('[commercial-ach] Telegram approval failed:', error)
    await answerTelegramCallback(
      params.callbackQueryId,
      'The ACH request could not be updated.',
      true,
    )
  }
  return true
}
