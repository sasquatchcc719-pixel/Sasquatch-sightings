/**
 * Fiber vision analysis.
 *
 * Order of authority, highest first:
 *   1. The deterministic stop list (stop-list.ts) run over the care-tag text.
 *   2. The burn test bucket, if the tech ran one.
 *   3. The model's own judgement.
 *
 * Readable face composition corrects unsupported visual guesses. Care,
 * construction and dye-test restrictions still take precedence over clearance.
 */

import OpenAI from 'openai'
import {
  burnTestVerdict,
  escalate,
  scanTagText,
  type BurnBucket,
} from './stop-list'
import { FIBER_FIELD_REFERENCE } from './reference'
import type { FiberCheckResult, FiberConfidence, FiberVerdict } from './types'

const MODEL = process.env.FIBER_CHECK_MODEL || 'gpt-5.5'

const SYSTEM_PROMPT = `You are the fiber identification check for Sasquatch Carpet Cleaning. A technician is standing in a customer's home with a rug or piece of upholstery and needs to know whether it is safe to wet clean, right now, before any water touches it.

This crew has exactly two methods: hot water extraction (truckmount, Hydro-Force, CRB) and encapsulation (Releasit DS2, 19" bonnet). There is no solvent machine and no dry compound system. Every recommendation you give must resolve to hot water extraction, encapsulation, vacuum only, or "do not clean it — take it off the invoice". Never recommend a method they do not own; that reads as a refusal with no way forward.

Identify from evidence. False refusals and false clearances both matter. Read the label before reasoning about cleaning. A readable fiber-content label, including handwriting, outranks a guess from sheen, age, price, origin, or construction. Never invent a hazardous fiber to justify caution.

WHAT YOU RECEIVE
- Photos: a care tag, the pile/face of the item, or the backing. Read any tag by OCR and transcribe it exactly.
- Optionally, the result of a burn test the tech already ran.
- Optionally, notes from the tech.

FIBER EVIDENCE
- Wool and polyester are normally suitable for professional wet cleaning. Wool needs wool-safe chemistry, controlled temperature, gentle agitation, dye testing and prompt drying. Polyester/PET, nylon and polypropylene/olefin are not regenerated cellulose. Polyester alone is not a reason to restrict extraction.
- Viscose/rayon and viscose-marketed art silk/bamboo silk are moisture-sensitive. Tencel/lyocell, modal and cupro are other regenerated cellulosics, not synonyms for every shiny fiber; retain the crew's conservative restriction when actually identified. Sheen alone cannot distinguish these from wool or synthetics. Never call a rug viscose merely because it looks silky. Synthetic product names can include "silk".
- Keep face/pile fiber separate from backing, warp, foundation, foam and batting. A polyester pile on cotton foundation is still a polyester rug. Cotton foundation needs controlled moisture and drying, not an automatic low-moisture verdict. Jute foundation needs a separate browning warning; jute face fiber remains restricted.
- Furniture law tags describing foam, batting, felt, stuffing or flame compliance do NOT identify the upholstery cover. Do not call a cover polyester from polyester filling. Ask for its fabric care/content label or a cover-fiber test. Flammability boilerplate is not a cleaning prohibition.
- Extra restrictions require specific evidence: an explicit care instruction, visible backing deterioration, a sensitive finish, or a reported failed dye test. A generic possibility of dye bleed is a pre-test reminder, not proof of unstable dyes.

VISUAL TELLS
- Viscose: silvery shifting sheen, low dense pile, cool slick hand, often machine-made with a cotton foundation.
- Wool: matte, crimped, springy, warm hand, recovers when crushed.
- Silk: extremely fine, high natural luster, usually hand-knotted, very high knot density.
- Synthetic: uniform color, plasticky sheen, springs back, no variation between fibers.
- Jute/sisal: coarse, ropy, visibly plant-like, often flatwoven.

ALSO WATCH FOR
- ACETATE: destroyed by acetone and damaged by alcohol, so a solvent spotter ruins it as surely as water does. Call it out explicitly if a tag shows acetate or triacetate.
- MODACRYLIC / faux fur: melts and mats at low heat.

TRANSCRIBE THE TAG EXACTLY
If any tag is visible, put its full text in tag_text verbatim, including fiber percentages, collection and design codes, and any care symbols or cleaning codes. Mark unreadable words [illegible]; never complete handwriting using your suspected fiber. Put only the clearly readable face/pile/cover composition in tag_fiber, empty when absent or ambiguous. Set tag_confidence to low for ambiguous handwriting. Do not add viscose or any other fiber that you cannot actually read. Downstream checks match this transcription; matching a guessed word does not confirm the material.

Set restriction_basis to fiber only when the identified face fiber itself requires a restriction; care_instructions for explicit cleaning restrictions; construction for a specific backing/finish issue; dye_test only for actual reported color transfer; unidentified when the evidence cannot identify the face fiber; otherwise none. Keep fiber, verdict, warnings, method, summary and next_test consistent. If the content line is unreadable, say fiber unknown and request a sharp close-up of that line before proposing a burn test. Never request a fringe/backing burn test to identify the pile; only a sample of the actual face yarn can do that.

CONFIDENCE
Use "high" only when a tag states fiber content, or the item is unmistakable. Photos of pile alone rarely justify "high". When you are not confident, set confidence low and put the single most useful next test in next_test — one test, the simplest one, not a list.

The tech reads this on a phone with a customer standing next to them. Be terse and concrete.

${FIBER_FIELD_REFERENCE}`

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
  tag_fiber?: string
  tag_confidence?: FiberConfidence
  restriction_basis?:
    | 'none'
    | 'fiber'
    | 'care_instructions'
    | 'construction'
    | 'dye_test'
    | 'unidentified'
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
    'tag_fiber',
    'tag_confidence',
    'restriction_basis',
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
    tag_fiber: {
      type: 'string',
      description:
        'Readable face/pile/cover composition only, excluding backing and filling. Empty if uncertain or absent.',
    },
    tag_confidence: {
      type: 'string',
      enum: ['high', 'medium', 'low'],
      description:
        'Confidence in the face-fiber content reading specifically, independent of illegible design codes or other label text.',
    },
    restriction_basis: {
      type: 'string',
      enum: [
        'none',
        'fiber',
        'care_instructions',
        'construction',
        'dye_test',
        'unidentified',
      ],
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

/** Fibre words that mean the tag already states its content. */
const CONTENT_WORDS =
  /\b(viscose|rayon|wool|silk|cotton|polyester|nylon|olefin|polypropylene|acrylic|linen|jute|sisal|acetate|leather|bamboo|tencel|lyocell|modal|hemp|ramie|modacrylic)\b/i

/**
 * A tag that names a collection or a brand but no fibre content is the case
 * worth looking up — that is a guess from the pile otherwise. A tag that
 * already states its content does not need the internet.
 */
export function lookupQueryFor(tagText: string): string | null {
  const text = (tagText || '').trim()
  if (text.length < 8) return null
  if (CONTENT_WORDS.test(text) || /\d\s*%/.test(text)) return null

  // Keep the identifying bits: brand words and design codes, dropped of the
  // boilerplate care paragraph that appears on every tag.
  const cleaned = text
    .split(/\n/)
    .filter(
      (line) =>
        !/care|clean|vacuum|professional|warranty|made in|www\.|\.com/i.test(
          line,
        ),
    )
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120)

  if (cleaned.length < 6) return null
  return `${cleaned} rug upholstery fiber content material`
}

/**
 * Look up a tag that names a product but not its fibre. Never throws — a
 * failed search must not block a tech, it just means we fall back to the
 * photo.
 */
async function researchTag(
  openai: OpenAI,
  query: string,
): Promise<string | null> {
  try {
    const result = await (
      openai as unknown as {
        responses: {
          create: (args: unknown) => Promise<{ output_text?: string }>
        }
      }
    ).responses.create({
      model: MODEL,
      tools: [{ type: 'web_search' }],
      input: `What fibre content is this rug or upholstery item made of? Quote the source. If you cannot find this exact product, say so plainly rather than guessing.\n\n${query}`,
    })
    const text = result.output_text?.trim()
    return text ? text.slice(0, 2000) : null
  } catch (error) {
    // No search available, or the call failed. Never blocks the tech.
    console.error('[fiber] tag lookup failed:', error)
    return null
  }
}

export type FiberAnalysis = FiberCheckResult & {
  tagText: string
  raw: ModelOutput | null
  /** Plain-language record of how the verdict was reached, in order. */
  trail: string[]
  /** Verbatim what a web lookup returned, when one ran. */
  researchNotes: string | null
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
    max_completion_tokens: 2200,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: [
          { type: 'text' as const, text: contextLines.join('\n') },
          ...input.images.map((url) => ({
            type: 'image_url' as const,
            image_url: { url, detail: 'high' as const },
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

  let parsed = JSON.parse(content) as ModelOutput
  let usedResearch = false
  let researchNotes: string | null = null

  // Second pass: when the tag names a product but never says what it is made
  // of, look it up rather than guessing from the pile. The model sees its own
  // first answer and the search results, and may revise.
  const query = lookupQueryFor(parsed.tag_text ?? '')
  if (query) {
    const research = await researchTag(openai, query)
    researchNotes = research
    if (research) {
      try {
        const second = await openai.chat.completions.create({
          model: MODEL,
          max_completion_tokens: 2200,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: contextLines.join('\n') },
            { role: 'assistant', content: JSON.stringify(parsed) },
            {
              role: 'user',
              content: `The tag names a product but not its fibre content, so these search results were pulled for "${query}".\n\n${research}\n\nIf they identify the fibre, revise your answer and raise confidence. If they are irrelevant or contradictory, keep your original answer and do NOT raise confidence. Keep tag_text exactly as you transcribed it — do not add anything the tag does not say.`,
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
        const revisedRaw = second.choices[0]?.message?.content
        if (revisedRaw) {
          const revised = JSON.parse(revisedRaw) as ModelOutput
          // The tag transcription is evidence. Keep the one read off the photo
          // so the stop list never scans text that came from the internet.
          parsed = {
            ...revised,
            // The tag transcription is evidence from the photo. Never let
            // text from the internet reach the stop list.
            tag_text: parsed.tag_text,
            tag_fiber: parsed.tag_fiber,
            tag_confidence: parsed.tag_confidence,
          }
          usedResearch = true
        }
      } catch (error) {
        console.error('[fiber] second pass failed, using first answer:', error)
      }
    }
  }

  return reconcile(parsed, {
    ...input,
    usedResearch,
    researchNotes,
    researchQuery: query,
    hasTag: input.hasTag,
  })
}

/**
 * Combine the model's answer with the deterministic checks. Deterministic
 * restrictions win; readable content can correct unsupported fiber suspicion.
 */
export function reconcile(
  parsed: ModelOutput,
  input: Pick<AnalyzeInput, 'burnResult'> & {
    usedResearch?: boolean
    researchNotes?: string | null
    researchQuery?: string | null
    hasTag?: boolean
  },
): FiberAnalysis {
  const trail: string[] = []
  let verdict: FiberVerdict = parsed.verdict
  let determinedBy: FiberAnalysis['determinedBy'] = 'ai_vision'
  let fiber = parsed.fiber
  let warnings = [...(parsed.warnings ?? [])]
  let recommendedMethod = parsed.recommended_method
  let confidence: FiberConfidence = parsed.confidence

  const tagRead = (parsed.tag_text ?? '').trim()
  trail.push(
    tagRead
      ? `Tag read from the photo: "${tagRead.replace(/\s+/g, ' ').slice(0, 200)}"`
      : input.hasTag
        ? 'Tech said there was a tag, but nothing readable was found in the photo.'
        : 'No care tag — identified from the photo of the pile.',
  )

  const hits = scanTagText(tagRead)
  const faceHits = scanTagText(parsed.tag_fiber ?? '').filter(
    (hit) => hit.kind === 'fiber',
  )
  const confirmedFace =
    parsed.tag_confidence === 'high' &&
    !/unknown|unidentified|illegible|\?/i.test(parsed.tag_fiber ?? '') &&
    faceHits.length > 0 &&
    faceHits.every(
      (hit) =>
        hit.verdict === 'go' &&
        hits.some((tagHit) => tagHit.fiber === hit.fiber),
    )
  let nextTest = parsed.next_test?.trim() || null
  let guidanceReplaced = false

  // Only unsupported fiber suspicion can be corrected by a readable content
  // label. A failed dye test or a backing/care restriction remains independent.
  if (confirmedFace && !input.burnResult) {
    fiber = parsed.tag_fiber!.trim()
    confidence = 'high'
    if (
      parsed.restriction_basis === 'fiber' ||
      parsed.restriction_basis === 'none'
    ) {
      verdict = 'go'
      determinedBy = 'stop_list'
      warnings = faceHits.flatMap((hit) => hit.warnings)
      recommendedMethod = (
        faceHits.find((hit) => hit.fiber === 'Wool') ?? faceHits[0]
      ).recommendedMethod
      nextTest = null
      guidanceReplaced = true
      trail.push(
        'Readable face-fiber content takes precedence over an unsupported visual fiber guess.',
      )
    }
  }

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
      trail.push(
        `Burn test: fibres ${input.burnResult.replace(/_/g, ' ')} → ${burn.fiber}.`,
      )
    }
  } else {
    trail.push('Burn test: not run.')
  }

  // 2. The stop list, run over the model's own tag transcription. This is the
  // authority — it overrides everything above it.
  trail.push(
    hits.length > 0
      ? `Tag rules matched "${hits[0].term}" in the transcription → ${hits[0].fiber}. This depends on the accuracy of the tag reading.`
      : tagRead
        ? 'Our fibre list found nothing dangerous in the tag text.'
        : 'Our fibre list had no tag text to check.',
  )
  if (hits.length > 0) {
    const top = hits[0]
    const escalated = escalate(verdict, top.verdict)
    if (escalated === top.verdict && top.verdict !== 'go') {
      verdict = top.verdict
      determinedBy = 'stop_list'
      fiber =
        top.kind === 'fiber'
          ? top.fiber
          : confirmedFace
            ? parsed.tag_fiber!.trim()
            : fiber
      warnings = [...top.warnings, ...warnings]
      recommendedMethod = top.recommendedMethod
      confidence = parsed.tag_confidence ?? 'high'
      guidanceReplaced = true
    } else {
      verdict = escalated
    }
  }

  // Foundation precautions should accompany, not replace, a known pile fiber.
  warnings = [
    ...hits
      .filter((hit) => hit.kind === 'construction')
      .flatMap((hit) => hit.warnings),
    ...warnings,
  ]

  if (
    parsed.tag_confidence === 'low' &&
    parsed.restriction_basis === 'fiber' &&
    !input.burnResult &&
    !hits.some((hit) => hit.kind !== 'fiber' && hit.verdict !== 'go')
  ) {
    fiber = 'Unconfirmed face fiber — tag content unclear'
    verdict = 'do_not_wet_clean'
    confidence = 'low'
    determinedBy = 'ai_vision'
    warnings = [
      'The content line could not be read confidently. A suspected fiber is not a confirmed identification.',
    ]
    recommendedMethod =
      'Vacuum only until the face-fiber content is confirmed. Do not extract or encapsulate based on a guessed tag reading.'
    nextTest = 'Get a sharp close-up of the handwritten content line.'
    guidanceReplaced = true
    trail.push(
      'Low-confidence content reading: the material is unconfirmed, not a confirmed stop-list fiber.',
    )
  }

  // A web lookup may RAISE suspicion but must never clear an item. Asked about
  // the exact rug that started this project — Surya Graphite GPH-52, a tag that
  // reads 100% VISCOSE — web search answered "polyester". Confidently, and
  // wrong. Anything cleared on internet evidence alone gets held at
  // encapsulation until a tag or a burn test says otherwise.
  if (
    verdict === 'go' &&
    input.usedResearch &&
    !input.burnResult &&
    !confirmedFace
  ) {
    verdict = 'low_moisture'
    warnings = [
      'Cleared only by a web lookup, which is not reliable for rug fibre content — held at low moisture.',
      'Confirm the actual face yarn, not the fringe or backing, before extracting.',
      ...warnings,
    ]
    recommendedMethod =
      'Encapsulation until confirmed. A burn test clears it for extraction; a product listing does not.'
  }

  // A rug with no tag, no burn test and no confident identification must not
  // come back "safe". Being wrong the safe way costs a light clean; being wrong
  // the other way costs the rug. Encapsulation is the floor until something
  // actually identifies it.
  if (
    verdict === 'go' &&
    determinedBy === 'ai_vision' &&
    (confidence !== 'high' || (input.hasTag && parsed.tag_fiber === '')) &&
    !input.burnResult &&
    !confirmedFace
  ) {
    verdict = 'low_moisture'
    warnings = [
      'Not positively identified — no readable face-fiber content or confirming face-yarn test.',
      'Treated as low moisture until identified. Run the burn test to clear it for extraction.',
      ...warnings,
    ]
    recommendedMethod =
      'Encapsulation only after an inconspicuous color/texture pre-test. Confirm the actual pile/cover before extraction; a fringe, backing or filling test cannot identify it.'
    nextTest ||= input.hasTag
      ? 'Get a sharp close-up of the face-fiber content label.'
      : 'Test an inconspicuous sample of the actual face yarn, not the fringe or backing.'
  }

  if (input.usedResearch && input.researchNotes) {
    trail.push(
      `Tag named a product but no fibre, so it was looked up${input.researchQuery ? ` ("${input.researchQuery.slice(0, 80)}")` : ''}. The web said: ${input.researchNotes.replace(/\s+/g, ' ').slice(0, 400)}`,
    )
    trail.push(
      'Web results are treated as weak evidence and can never clear an item on their own.',
    )
  } else if (input.researchQuery) {
    trail.push('A web lookup was attempted but returned nothing usable.')
  }

  trail.push(
    `AI read of the photo: ${parsed.fiber || 'no call'} (confidence ${parsed.confidence}).`,
  )
  trail.push(
    `FINAL: ${verdict.replace(/_/g, ' ').toUpperCase()} — decided by ${
      determinedBy === 'stop_list'
        ? 'rules applied to the transcribed tag (dependent on reading accuracy)'
        : determinedBy === 'burn_test'
          ? 'the burn test'
          : 'the AI read of the photo'
    }.`,
  )

  // De-duplicate while preserving order.
  warnings = [...new Set(warnings.map((w) => w.trim()).filter(Boolean))]

  return {
    verdict,
    determinedBy,
    fiber: fiber || null,
    confidence,
    warnings,
    recommendedMethod: recommendedMethod || null,
    nextTest,
    summary:
      guidanceReplaced || verdict !== parsed.verdict || fiber !== parsed.fiber
        ? `${fiber || 'Fiber not confirmed'}. ${verdict === 'go' ? 'Suitable for controlled extraction after the normal pre-test.' : verdict === 'low_moisture' ? 'Use the restricted moisture protocol; see care and backing precautions.' : 'Do not wet clean; confirm the restriction before proceeding.'}`
        : parsed.summary,
    tagText: parsed.tag_text ?? '',
    raw: parsed,
    trail,
    researchNotes: input.researchNotes ?? null,
  }
}
