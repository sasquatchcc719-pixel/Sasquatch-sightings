/**
 * Fiber vision analysis.
 *
 * Order of authority, highest first:
 *   1. The deterministic stop list (stop-list.ts) run over the care-tag text.
 *   2. The burn test bucket, if the tech ran one.
 *   3. The model's own judgement.
 *
 * The model can only make a verdict MORE conservative. It is never allowed to
 * clear an item the stop list flagged — that is the whole point of having a
 * stop list rather than trusting the prompt.
 */

import OpenAI from 'openai'
import {
  burnTestVerdict,
  escalate,
  scanTagText,
  type BurnBucket,
} from './stop-list'
import type {
  FiberCheckResult,
  FiberConfidence,
  FiberVerdict,
} from './types'

const MODEL = process.env.FIBER_CHECK_MODEL || 'gpt-4o'

const SYSTEM_PROMPT = `You are the fiber identification check for Sasquatch Carpet Cleaning. A technician is standing in a customer's home with a rug or piece of upholstery and needs to know whether it is safe to wet clean, right now, before any water touches it.

Your job is identification, not reassurance. A wrong "safe" answer destroys a customer's property and costs an insurance claim. A wrong "unsafe" answer costs thirty seconds. Bias hard toward caution.

WHAT YOU RECEIVE
- Photos: a care tag, the pile/face of the item, or the backing. Read any tag by OCR and transcribe it exactly.
- Optionally, the result of a burn test the tech already ran.
- Optionally, notes from the tech.

THE FIBER THAT MATTERS MOST
Viscose (also sold as rayon, art silk, faux silk, bamboo silk, banana silk, sari silk, Tencel, lyocell, modal) is regenerated cellulose from wood pulp. It loses roughly half its tensile strength when wet, browns permanently, and the pile crushes and never recovers. It is the single most common cause of destroyed rugs in this trade and it is extremely common in mass-market rugs sold since the mid-2010s. If a rug has a bright silvery sheen that shifts dramatically with viewing angle ("flops" light to dark as you walk around it) on a low dense pile, suspect viscose even with no tag.

VISUAL TELLS
- Viscose: silvery shifting sheen, low dense pile, cool slick hand, often machine-made with a cotton foundation.
- Wool: matte, crimped, springy, warm hand, recovers when crushed.
- Silk: extremely fine, high natural luster, usually hand-knotted, very high knot density.
- Synthetic: uniform color, plasticky sheen, springs back, no variation between fibers.
- Jute/sisal: coarse, ropy, visibly plant-like, often flatwoven.

TRANSCRIBE THE TAG EXACTLY
If any tag is visible, put its full text in tag_text verbatim, including fiber percentages, collection and design codes, and any care symbols or cleaning codes. Do not summarize it. Downstream safety checks run string matching over this field, so a paraphrase can defeat them.

CONFIDENCE
Use "high" only when a tag states fiber content, or the item is unmistakable. Photos of pile alone rarely justify "high". When you are not confident, set confidence low and put the single most useful next test in next_test — one test, the simplest one, not a list.

The tech reads this on a phone with a customer standing next to them. Be terse and concrete.`

type AnalyzeInput = {
  /** Data URLs or public URLs. */
  images: string[]
  itemKind: 'rug' | 'upholstery'
  itemLabel: string
  techNotes?: string | null
  burnResult?: BurnBucket | null
  hasTag: boolean
}

type ModelOutput = {
  tag_text: string
  fiber: string
  confidence: FiberConfidence
  verdict: FiberVerdict
  warnings: string[]
  recommended_method: string
  next_test: string
  summary: string
}

const RESPONSE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'tag_text',
    'fiber',
    'confidence',
    'verdict',
    'warnings',
    'recommended_method',
    'next_test',
    'summary',
  ],
  properties: {
    tag_text: {
      type: 'string',
      description:
        'Verbatim transcription of any care tag visible in the photos. Empty string if no tag is visible.',
    },
    fiber: {
      type: 'string',
      description: 'Best identification of the fiber content.',
    },
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
    verdict: {
      type: 'string',
      enum: ['go', 'low_moisture', 'do_not_wet_clean'],
    },
    warnings: {
      type: 'array',
      items: { type: 'string' },
      description: 'Specific hazards. Empty array if genuinely none.',
    },
    recommended_method: { type: 'string' },
    next_test: {
      type: 'string',
      description:
        'The single next test to run if confidence is not high. Empty string if no further test is needed.',
    },
    summary: {
      type: 'string',
      description: 'One or two sentences a tech can read at a glance.',
    },
  },
} as const

export type FiberAnalysis = FiberCheckResult & {
  tagText: string
  raw: ModelOutput | null
}

export async function analyzeFiber(
  input: AnalyzeInput,
): Promise<FiberAnalysis> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) throw new Error('OPENAI_API_KEY is not configured')

  const openai = new OpenAI({ apiKey })

  const contextLines = [
    `Item: ${input.itemLabel} (${input.itemKind})`,
    input.hasTag
      ? 'The tech says there IS a care tag — read it.'
      : 'The tech says there is NO care tag. Identify from the pile, backing, sheen, and construction.',
  ]
  if (input.burnResult) {
    const bucketLabel: Record<BurnBucket, string> = {
      melts: 'melted into a hard bead',
      burning_hair: 'smelled like burning hair and self-extinguished',
      burns_like_paper: 'burned fast like paper and left soft ash',
    }
    contextLines.push(
      `Burn test already performed: the fibers ${bucketLabel[input.burnResult]}.`,
    )
  }
  if (input.techNotes?.trim()) {
    contextLines.push(`Tech notes: ${input.techNotes.trim()}`)
  }

  const completion = await openai.chat.completions.create({
    model: MODEL,
    max_completion_tokens: 900,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: [
          { type: 'text' as const, text: contextLines.join('\n') },
          ...input.images.map((url) => ({
            type: 'image_url' as const,
            image_url: { url },
          })),
        ],
      },
    ],
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: 'fiber_check',
        strict: true,
        schema: RESPONSE_SCHEMA,
      },
    },
  })

  const content = completion.choices[0]?.message?.content
  if (!content) throw new Error('Fiber analysis returned no content')

  const parsed = JSON.parse(content) as ModelOutput
  return reconcile(parsed, input)
}

/**
 * Combine the model's answer with the deterministic checks. Deterministic
 * always wins; the model may only escalate.
 */
export function reconcile(
  parsed: ModelOutput,
  input: Pick<AnalyzeInput, 'burnResult'>,
): FiberAnalysis {
  let verdict: FiberVerdict = parsed.verdict
  let determinedBy: FiberAnalysis['determinedBy'] = 'ai_vision'
  let fiber = parsed.fiber
  let warnings = [...(parsed.warnings ?? [])]
  let recommendedMethod = parsed.recommended_method
  let confidence: FiberConfidence = parsed.confidence

  // 1. Burn test bucket, if one was run.
  if (input.burnResult) {
    const burn = burnTestVerdict(input.burnResult)
    const escalated = escalate(verdict, burn.verdict)
    if (escalated !== verdict || burn.verdict === verdict) {
      verdict = escalated
      determinedBy = 'burn_test'
      fiber = burn.fiber
      warnings = [...burn.warnings, ...warnings]
      recommendedMethod = burn.recommendedMethod
      confidence = 'high'
    }
  }

  // 2. The stop list, run over the model's own tag transcription. This is the
  // authority — it overrides everything above it.
  const hits = scanTagText(parsed.tag_text ?? '')
  if (hits.length > 0) {
    const top = hits[0]
    const escalated = escalate(verdict, top.verdict)
    if (escalated === top.verdict && top.verdict !== 'go') {
      verdict = top.verdict
      determinedBy = 'stop_list'
      fiber = top.fiber
      warnings = [...top.warnings, ...warnings]
      recommendedMethod = top.recommendedMethod
      confidence = 'high'
    } else {
      verdict = escalated
    }
  }

  // De-duplicate while preserving order.
  warnings = [...new Set(warnings.map((w) => w.trim()).filter(Boolean))]

  return {
    verdict,
    determinedBy,
    fiber: fiber || null,
    confidence,
    warnings,
    recommendedMethod: recommendedMethod || null,
    nextTest: parsed.next_test?.trim() ? parsed.next_test.trim() : null,
    summary: parsed.summary,
    tagText: parsed.tag_text ?? '',
    raw: parsed,
  }
}
