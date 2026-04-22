/**
 * Harry Draft API
 * Generates a Harry AI draft reply for a conversation WITHOUT sending it.
 * Used in the admin thread view when ai_enabled = false (ops customers) —
 * the admin reviews the draft, edits if needed, and hits Send manually.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/supabase/server'
import { getUserWithRole } from '@/lib/auth'
import { generateAIResponse } from '@/lib/openai-chat'

type Message = {
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp?: string
}

function sourceToChannelKey(
  source: string | null,
): 'inbound' | 'lsa' | 'vendor' | 'business_card' | 'contest' | 'nextdoor' {
  if (!source) return 'inbound'
  const s = source.toLowerCase()
  if (s === 'google lsa' || s === 'lsa') return 'lsa'
  if (s === 'nfc card' || s === 'nfc_card') return 'vendor'
  if (s === 'business card') return 'business_card'
  if (s === 'contest') return 'contest'
  return 'inbound'
}

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { user, role } = await getUserWithRole()
    if (!user || !role || !['admin', 'owner', 'dispatcher'].includes(role)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id: conversationId } = await params
    const supabase = createAdminClient()

    const { data: conversation, error } = await supabase
      .from('conversations')
      .select('*')
      .eq('id', conversationId)
      .single()

    if (error || !conversation) {
      return NextResponse.json(
        { error: 'Conversation not found' },
        { status: 404 },
      )
    }

    const messages = (conversation.messages as Message[]) || []
    const lastUserMessage = [...messages]
      .reverse()
      .find((m) => m.role === 'user')

    if (!lastUserMessage) {
      return NextResponse.json(
        { error: 'No customer message found in conversation' },
        { status: 400 },
      )
    }

    const channelKey = sourceToChannelKey(conversation.source)

    const draft = await generateAIResponse(
      lastUserMessage.content,
      messages,
      undefined,
      channelKey,
    )

    return NextResponse.json({ draft })
  } catch (err) {
    console.error('[harry-draft] error:', err)
    return NextResponse.json(
      { error: 'Failed to generate draft' },
      { status: 500 },
    )
  }
}
