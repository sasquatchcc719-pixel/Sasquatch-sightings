/**
 * Ranger Gmail Intake Cron
 * Polls the Sasquatch hiring Gmail account and turns matching emails into
 * Ranger applicant records without relying on Zapier.
 */

import { NextRequest, NextResponse } from 'next/server'
import { processRangerGmailMessage } from '@/lib/ranger/applicants'
import {
  getRangerGmailMessage,
  listRangerGmailMessages,
  markRangerGmailMessageProcessed,
} from '@/lib/ranger/gmail'
import { createAdminClient } from '@/supabase/server'

const DEFAULT_BATCH_SIZE = 10

export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization')
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const batchSize = Math.min(
      Number(process.env.RANGER_GMAIL_BATCH_SIZE || DEFAULT_BATCH_SIZE),
      25,
    )
    const messageIds = await listRangerGmailMessages(batchSize)
    const supabase = createAdminClient()
    const results = {
      found: messageIds.length,
      created: 0,
      repliesQueued: 0,
      duplicates: 0,
      failed: 0,
      errors: [] as string[],
    }

    for (const messageId of messageIds) {
      try {
        const message = await getRangerGmailMessage(messageId)
        const result = await processRangerGmailMessage({
          supabase,
          message,
        })

        if (result.action === 'duplicate') {
          results.duplicates++
        } else if (result.action === 'reply_queued') {
          results.repliesQueued++
          await markRangerGmailMessageProcessed(message.messageId)
        } else {
          results.created++
          await markRangerGmailMessageProcessed(message.messageId)
        }
      } catch (messageError) {
        results.failed++
        results.errors.push(
          messageError instanceof Error
            ? `${messageId}: ${messageError.message}`
            : `${messageId}: unknown error`,
        )
      }
    }

    return NextResponse.json(results)
  } catch (error) {
    console.error('[cron/ranger-gmail-intake] Error:', error)
    return NextResponse.json(
      { error: 'Failed to run Ranger Gmail intake' },
      { status: 500 },
    )
  }
}
