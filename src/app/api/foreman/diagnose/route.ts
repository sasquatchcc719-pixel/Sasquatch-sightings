/**
 * Foreman — field AI diagnostic endpoint (Module 4B).
 * POST { messages: [{ role, text, images?: dataUrl[] }] }
 * → { reply }
 *
 * Every call injects the live inventory (in-stock + spec-approved products
 * only) and the Sasquatch field protocols. Multi-turn: the client sends the
 * whole conversation each time so tactile-test follow-ups ("water beaded")
 * keep their context. Each exchange is logged to ai_diagnostic_logs.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createAnthropic } from '@ai-sdk/anthropic'
import { generateText, type ModelMessage } from 'ai'
import { requireAnyRole } from '@/lib/auth'
import { createAdminClient } from '@/supabase/server'
import {
  FOREMAN_SYSTEM_PROMPT,
  buildInventoryContext,
} from '@/lib/foreman/prompt'
import { SASQUATCH_FIELD_PROTOCOLS } from '@/lib/foreman/protocols'
import type { ChemicalProduct } from '@/lib/foreman/types'

export const maxDuration = 60

const anthropic = createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

type IncomingMessage = {
  role: 'user' | 'assistant'
  text: string
  images?: string[] // data URLs, already downscaled client-side
}

export async function POST(request: NextRequest) {
  let access
  try {
    access = await requireAnyRole(['admin', 'owner', 'tech'])
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json()
  const incoming: IncomingMessage[] = Array.isArray(body.messages)
    ? body.messages
    : []
  if (incoming.length === 0) {
    return NextResponse.json({ error: 'messages required' }, { status: 400 })
  }

  const supabase = createAdminClient()
  const { data: products } = await supabase
    .from('chemical_products')
    .select('*')
    .order('name', { ascending: true })

  const system =
    FOREMAN_SYSTEM_PROMPT +
    '\n\n' +
    SASQUATCH_FIELD_PROTOCOLS +
    '\n\n' +
    buildInventoryContext((products ?? []) as ChemicalProduct[])

  const messages: ModelMessage[] = incoming.map((m) => {
    if (m.role === 'assistant') {
      return { role: 'assistant' as const, content: m.text }
    }
    const parts: Array<
      { type: 'text'; text: string } | { type: 'image'; image: string }
    > = []
    for (const img of m.images ?? []) {
      parts.push({ type: 'image', image: img })
    }
    parts.push({ type: 'text', text: m.text || '(photo only)' })
    return { role: 'user' as const, content: parts }
  })

  try {
    const { text: reply } = await generateText({
      model: anthropic('claude-sonnet-5'),
      system,
      messages,
      maxOutputTokens: 1200,
    })

    const last = incoming[incoming.length - 1]
    await supabase.from('ai_diagnostic_logs').insert({
      user_id: access.id,
      photo_urls: [],
      transcript: incoming
        .map(
          (m) =>
            `${m.role}: ${m.text}${m.images?.length ? ` [${m.images.length} photo(s)]` : ''}`,
        )
        .join('\n'),
      detected: null,
      recommendation: { reply, prompt: last.text },
      guardrails_fired: [],
    })

    return NextResponse.json({ reply })
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    console.error('[foreman/diagnose] failed:', err)
    return NextResponse.json(
      { error: `Diagnosis failed: ${detail.slice(0, 200)}` },
      { status: 500 },
    )
  }
}
