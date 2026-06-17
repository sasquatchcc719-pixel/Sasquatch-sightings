/**
 * Harry (next) — company knowledge / general Q&A.
 *
 * Reuses the curated knowledge in `harry_knowledge_blocks` (company profile,
 * FAQ, brand voice, do-not-say, escalation policy) — the *facts*, not old Harry's
 * broken action logic. This path only answers questions; it never books, edits,
 * or quotes a real job, so it's walled off from the booking/removal flows.
 *
 * The model answers ONLY from the provided knowledge, follows the do-not-say
 * rules, and ESCALATES (instead of answering) anything the escalation policy
 * covers or anything the knowledge doesn't cover. The model call is injected so
 * this is unit-testable.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import type { IntentModel } from './read-intent'

export type KnowledgeBlock = {
  categoryKey: string
  title: string
  content: string
}

export async function loadKnowledgeBlocks(
  supabase: SupabaseClient,
): Promise<KnowledgeBlock[]> {
  const { data } = await supabase
    .from('harry_knowledge_blocks')
    .select('category_key, title, content, sort_order')
    .eq('is_enabled', true)
    .order('category_key', { ascending: true })
    .order('sort_order', { ascending: true })
  return (data ?? []).map((row) => ({
    categoryKey: String(row.category_key),
    title: String(row.title),
    content: String(row.content),
  }))
}

const answerSchema = z.object({
  action: z.enum(['answer', 'escalate', 'none']),
  reply: z.string().optional(),
  reason: z.string().optional(),
})

export type KnowledgeAnswer =
  | { status: 'answer'; reply: string }
  | { status: 'escalate'; reason: string }
  | { status: 'none' }

function buildKnowledgePrompt(blocks: KnowledgeBlock[]): string {
  const kb = blocks.map((b) => `## ${b.title}\n${b.content}`).join('\n\n')
  return `You are Harry, the SMS assistant for Sasquatch Carpet Cleaning, answering ONE inbound customer text.

Answer ONLY using the COMPANY KNOWLEDGE below. Never invent a price, policy, hours, or any fact that isn't in it.

Output ONLY JSON: {"action":"answer"|"escalate"|"none","reply":str?,"reason":str?}
- "answer": a normal question you can answer from the knowledge. Put the reply in the brand voice — friendly, local, concise. Do NOT state any price or policy not in the knowledge.
- "escalate": use this AND do NOT answer for anything the Escalation Policy covers (water emergencies, upset customers, complaints, refunds) or any question the knowledge does NOT cover. Give a short reason. Never guess.
- "none": the message isn't really a question (e.g. "thanks", "ok", "👍").
- Always follow the Do-Not-Say / Compliance rules.

COMPANY KNOWLEDGE:
${kb}`
}

export async function answerFromKnowledge(params: {
  message: string
  blocks: KnowledgeBlock[]
  model: IntentModel
}): Promise<KnowledgeAnswer> {
  const raw = await params.model({
    system: buildKnowledgePrompt(params.blocks),
    user: params.message,
  })

  let parsed: z.infer<typeof answerSchema>
  try {
    const stripped = raw
      .trim()
      .replace(/^```(?:json)?/i, '')
      .replace(/```$/, '')
      .trim()
    const result = answerSchema.safeParse(JSON.parse(stripped))
    // On unparseable output, escalate rather than send the customer garbage.
    if (!result.success)
      return { status: 'escalate', reason: 'unparseable answer' }
    parsed = result.data
  } catch {
    return { status: 'escalate', reason: 'unparseable answer' }
  }

  if (parsed.action === 'answer' && parsed.reply?.trim()) {
    return { status: 'answer', reply: parsed.reply.trim() }
  }
  if (parsed.action === 'escalate') {
    return { status: 'escalate', reason: parsed.reason || 'needs a human' }
  }
  return { status: 'none' }
}
