import { NextRequest, NextResponse } from 'next/server'
import {
  runRangerTelegramAction,
  runRangerTextAction,
} from '@/lib/ranger/actions'
import {
  approveAndExecuteRangerPendingAction,
  cancelRangerPendingAction,
} from '@/lib/ranger/approvals'
import { answerRangerTelegramMessage } from '@/lib/ranger/brain'
import {
  appendRangerCommandMessage,
  getOrCreateRangerCommandThread,
  markRangerTelegramUpdateProcessed,
} from '@/lib/ranger/memory'
import { sendRangerTelegramMessage } from '@/lib/ranger/telegram'
import { createAdminClient } from '@/supabase/server'

export const maxDuration = 60

type TelegramUpdate = {
  update_id?: number
  message?: {
    from: { id: number }
    chat: { id: number }
    text?: string
  }
  callback_query?: {
    id: string
    from: { id: number }
    message?: { chat: { id: number } }
    data: string
  }
}

function getAllowedTelegramUserIds(): Set<string> {
  const raw = [
    process.env.RANGER_ALLOWED_TELEGRAM_USER_IDS,
    process.env.CHARLES_TELEGRAM_USER_ID,
    process.env.CHARLES_TELEGRAM_CHAT_ID,
  ]
    .filter(Boolean)
    .join(',')

  return new Set(
    raw
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
  )
}

function isAllowedTelegramUser(userId?: number): boolean {
  const allowed = getAllowedTelegramUserIds()
  if (allowed.size === 0) return true
  return Boolean(userId && allowed.has(String(userId)))
}

function verifyTelegramSecret(request: NextRequest): boolean {
  const expected = process.env.RANGER_TELEGRAM_SECRET_TOKEN
  if (!expected) return true
  return request.headers.get('x-telegram-bot-api-secret-token') === expected
}

async function answerCallbackQuery(callbackQueryId: string) {
  const token =
    process.env.RANGER_TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN
  if (!token) return

  await fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ callback_query_id: callbackQueryId }),
  })
}

export async function POST(request: NextRequest) {
  try {
    if (!verifyTelegramSecret(request)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const update = (await request.json()) as TelegramUpdate
    const actorId = update.message?.from.id || update.callback_query?.from.id
    if (!isAllowedTelegramUser(actorId)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const supabase = createAdminClient()
    const chatId =
      update.message?.chat.id || update.callback_query?.message?.chat.id || null
    const processed = await markRangerTelegramUpdateProcessed({
      supabase,
      updateId: update.update_id,
      chatId,
      userId: actorId || null,
      metadata: {
        hasMessage: Boolean(update.message),
        hasCallback: Boolean(update.callback_query),
      },
    })
    if (!processed) return NextResponse.json({ ok: true, duplicate: true })
    const thread = chatId
      ? await getOrCreateRangerCommandThread({
          supabase,
          chatId,
          userId: actorId || null,
        })
      : null

    if (update.message?.text) {
      const text = update.message.text
      const actor = actorId ? `telegram:${actorId}` : 'telegram'
      await supabase.from('ranger_messages').insert({
        channel: 'telegram',
        direction: 'inbound',
        body: text,
        status: 'logged',
        metadata: {
          chatId,
          telegramUserId: actorId || null,
        },
      })
      if (thread) {
        await appendRangerCommandMessage({
          supabase,
          threadId: thread.id,
          role: 'owner',
          body: text,
          metadata: { chatId, telegramUserId: actorId || null },
        })
      }

      const actionAnswer = await runRangerTextAction({
        supabase,
        text,
        actor,
      })
      const answer =
        actionAnswer ||
        (thread
          ? await answerRangerTelegramMessage({
              supabase,
              text,
              thread,
              actor,
              chatId,
            })
          : await Promise.resolve(
              'I need a Telegram chat context to use Ranger agent memory.',
            ))
      const sent = await sendRangerTelegramMessage({
        chatId,
        text: answer,
      })
      if (thread) {
        await appendRangerCommandMessage({
          supabase,
          threadId: thread.id,
          role: 'assistant',
          body: answer,
          metadata: {
            chatId,
            telegramUserId: actorId || null,
            generatedBy: actionAnswer ? 'ranger_action' : 'ranger_agent',
            sent,
          },
        })
      }

      await supabase.from('ranger_messages').insert({
        channel: 'telegram',
        direction: 'outbound',
        body: answer,
        status: sent ? 'sent' : 'failed',
        metadata: {
          chatId,
          telegramUserId: actorId || null,
          generatedBy: actionAnswer ? 'ranger_action' : 'ranger_openai',
        },
      })
    }

    if (update.callback_query?.data) {
      const [, action, applicantId] = update.callback_query.data.split(':')
      const actor = actorId ? `telegram:${actorId}` : 'telegram'
      if (action === 'approve' || action === 'cancel') {
        const actionResult =
          action === 'approve'
            ? await approveAndExecuteRangerPendingAction({
                supabase,
                actionId: applicantId,
                actor,
              })
            : await cancelRangerPendingAction({
                supabase,
                actionId: applicantId,
                actor,
              })
        await answerCallbackQuery(update.callback_query.id)
        const sent = await sendRangerTelegramMessage({
          chatId,
          text: actionResult,
        })
        if (thread) {
          await appendRangerCommandMessage({
            supabase,
            threadId: thread.id,
            role: 'assistant',
            body: actionResult,
            metadata: {
              chatId,
              telegramUserId: actorId || null,
              generatedBy: 'ranger_pending_action',
              pendingActionId: applicantId,
              sent,
            },
          })
        }
        await supabase.from('ranger_messages').insert({
          channel: 'telegram',
          direction: 'outbound',
          body: actionResult,
          status: sent ? 'sent' : 'failed',
          metadata: {
            chatId,
            telegramUserId: actorId || null,
            generatedBy: 'ranger_pending_action',
            rawAction: update.callback_query.data,
          },
        })
        return NextResponse.json({ ok: true })
      }

      await supabase.from('ranger_owner_decisions').insert({
        applicant_id: applicantId || null,
        decision_type: 'telegram_action',
        decision_value: action || 'unknown',
        telegram_user_id: actorId ? String(actorId) : null,
        metadata: {
          callbackQueryId: update.callback_query.id,
          raw: update.callback_query.data,
        },
      })

      await supabase.from('ranger_audit_events').insert({
        applicant_id: applicantId || null,
        actor: actorId ? `telegram:${actorId}` : 'telegram',
        event_type: 'telegram_action',
        event_summary: `Owner selected Ranger action: ${action || 'unknown'}`,
        payload: { raw: update.callback_query.data },
      })

      const actionResult = await runRangerTelegramAction({
        supabase,
        action,
        applicantId,
        actor,
      })
      await answerCallbackQuery(update.callback_query.id)
      const sent = await sendRangerTelegramMessage({
        chatId,
        text: actionResult,
      })

      await supabase.from('ranger_messages').insert({
        applicant_id: applicantId || null,
        channel: 'telegram',
        direction: 'outbound',
        body: actionResult,
        status: sent ? 'sent' : 'failed',
        metadata: {
          chatId,
          telegramUserId: actorId || null,
          generatedBy: 'ranger_action',
          rawAction: update.callback_query.data,
        },
      })
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('[telegram/ranger-command] Error:', error)
    return NextResponse.json(
      { error: 'Failed to process Ranger Telegram command' },
      { status: 500 },
    )
  }
}
