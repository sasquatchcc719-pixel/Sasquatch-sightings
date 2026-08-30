import OpenAI from 'openai'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  resolveVariant,
  type LossContext,
  type RestorationCatalogItem,
} from '@/lib/ops/restoration-catalog'

/**
 * Speech / shorthand -> restoration line items.
 *
 * The division of labour is the whole point. The model does the fuzzy half:
 * turning "remove carpet, 4 foot flood cut, 2 foot flood cut, remove pad, spray
 * antimicrobial" into a list of CONCEPTS. It never sees or chooses a price.
 * The loss context on the project — water category, time of call — then resolves
 * each concept to exactly one Xactimate code deterministically.
 *
 * That keeps a wrong guess cheap: the worst case is the wrong row appearing in a
 * list Charles confirms, never a silently mispriced invoice.
 */

export type ParsedLine = {
  conceptCode: string
  label: string
  code: string
  unit: string
  unitPrice: number
  quantity: number | null
  heard: string
  confidence: 'high' | 'low'
}

export type ParseResult =
  | { ok: true; lines: ParsedLine[]; unmatched: string[] }
  | { ok: false; error: string }

const MODEL = process.env.RESTORATION_ENTRY_MODEL || 'gpt-5.5'

export async function loadEnabledCatalog(
  supabase: SupabaseClient,
): Promise<RestorationCatalogItem[]> {
  const { data } = await supabase
    .from('restoration_catalog_items')
    .select(
      'id, code, description, unit, unit_price, water_category, after_hours, is_heavy, concept_code, concept_label, is_enabled, quickbooks_item_id',
    )
    .eq('is_enabled', true)
  return (data ?? []).map((r) => ({
    ...r,
    unit_price: Number(r.unit_price),
  })) as RestorationCatalogItem[]
}

/** One choice per distinct piece of work — never one per price variant. */
function conceptMenu(items: RestorationCatalogItem[]) {
  const seen = new Map<string, { code: string; label: string; unit: string }>()
  for (const item of items) {
    if (seen.has(item.concept_code)) continue
    seen.set(item.concept_code, {
      code: item.concept_code,
      label: item.concept_label,
      unit: item.unit,
    })
  }
  return Array.from(seen.values())
}

export async function parseRestorationLines(
  supabase: SupabaseClient,
  params: { transcript: string; context: LossContext },
): Promise<ParseResult> {
  const transcript = params.transcript.trim()
  if (!transcript) return { ok: true, lines: [], unmatched: [] }

  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) return { ok: false, error: 'OPENAI_API_KEY not configured' }

  const items = await loadEnabledCatalog(supabase)
  if (items.length === 0) return { ok: false, error: 'restoration catalog is empty' }

  const menu = conceptMenu(items)
  const menuText = menu.map((m) => `${m.code}\t${m.label}\t(${m.unit})`).join('\n')

  const system = [
    'You convert a restoration technician\'s spoken notes into line items.',
    'You are given a menu of work concepts, each with an ID, a description, and a unit.',
    'Return ONLY concepts from the menu, by their exact ID.',
    'The technician speaks in shorthand and may correct themselves mid-sentence;',
    'take the corrected version. Order does not matter. Ignore chatter that is not work.',
    '',
    'Never choose a price, a water category, or an after-hours variant — those are',
    'decided elsewhere. Pick only the kind of work.',
    '',
    'If a quantity is clearly stated ("four hundred square feet", "sixty feet of"),',
    'return it as a number. If not stated, return null. Never invent a quantity.',
    '',
    'Put anything you could not confidently match into "unmatched" rather than',
    'guessing at a concept.',
  ].join('\n')

  const schema = {
    type: 'object',
    additionalProperties: false,
    required: ['lines', 'unmatched'],
    properties: {
      lines: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['concept_id', 'heard', 'quantity', 'confident'],
          properties: {
            concept_id: { type: 'string' },
            heard: { type: 'string', description: 'the words this came from' },
            quantity: { type: ['number', 'null'] },
            confident: { type: 'boolean' },
          },
        },
      },
      unmatched: { type: 'array', items: { type: 'string' } },
    },
  }

  let parsed: {
    lines: Array<{
      concept_id: string
      heard: string
      quantity: number | null
      confident: boolean
    }>
    unmatched: string[]
  }

  try {
    const openai = new OpenAI({ apiKey })
    const completion = await openai.chat.completions.create({
      model: MODEL,
      messages: [
        { role: 'system', content: system },
        {
          role: 'user',
          content: `MENU (id, description, unit):\n${menuText}\n\nTECHNICIAN SAID:\n${transcript}`,
        },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: { name: 'restoration_lines', strict: true, schema },
      },
    })
    const raw = completion.choices[0]?.message?.content
    if (!raw) return { ok: false, error: 'no response from the model' }
    parsed = JSON.parse(raw)
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'extraction failed' }
  }

  const byConcept = new Set(menu.map((m) => m.code))
  const lines: ParsedLine[] = []
  const unmatched = [...(parsed.unmatched ?? [])]

  for (const entry of parsed.lines ?? []) {
    // A hallucinated concept id is dropped, never guessed at.
    if (!byConcept.has(entry.concept_id)) {
      unmatched.push(entry.heard || entry.concept_id)
      continue
    }
    const hit = resolveVariant(items, entry.concept_id, params.context)
    if (!hit) {
      unmatched.push(entry.heard || entry.concept_id)
      continue
    }
    lines.push({
      conceptCode: entry.concept_id,
      label: hit.concept_label,
      code: hit.code,
      unit: hit.unit,
      unitPrice: hit.unit_price,
      quantity:
        typeof entry.quantity === 'number' && Number.isFinite(entry.quantity)
          ? entry.quantity
          : null,
      heard: entry.heard ?? '',
      confidence: entry.confident ? 'high' : 'low',
    })
  }

  return { ok: true, lines, unmatched }
}
