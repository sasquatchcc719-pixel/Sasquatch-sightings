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
import { generateText, stepCountIs, tool, type ModelMessage } from 'ai'
import { z } from 'zod'
import { requireAnyRole } from '@/lib/auth'
import { createAdminClient } from '@/supabase/server'
import { readWebpage, searchGoogle } from '@/lib/web-search'
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

  // Real web-search grounding for obscure fabrics/care tags — the prompt's
  // diagnostic ladder step 3 depends on these actually existing.
  const tools = {
    web_search: tool({
      description:
        'Search the web for fabric/fiber care guidance, manufacturer care instructions, or obscure care-tag codes. Use for proprietary fabrics (Crypton, Sunbrella, Revolution), imported tags, or anything you cannot identify confidently.',
      inputSchema: z.object({
        query: z.string().describe('The search query'),
      }),
      execute: async ({ query }: { query: string }) => {
        try {
          const results = await searchGoogle(query, 4)
          if (results.length === 0) return 'No results found.'
          return results
            .map((r) => `${r.title}\n${r.url}\n${r.snippet}`)
            .join('\n\n')
        } catch {
          return 'Web search is unavailable right now — fall back to the tactile tests and the safe default protocol.'
        }
      },
    }),
    read_page: tool({
      description:
        'Fetch a webpage from a web_search result to read its full care guidance.',
      inputSchema: z.object({
        url: z.string().describe('URL from a web_search result'),
      }),
      execute: async ({ url }: { url: string }) => {
        try {
          return (await readWebpage(url)).slice(0, 6000)
        } catch {
          return 'Could not read that page.'
        }
      },
    }),
  }

  try {
    const { text: reply } = await generateText({
      model: anthropic('claude-sonnet-5'),
      system,
      messages,
      tools,
      stopWhen: stepCountIs(5),
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
