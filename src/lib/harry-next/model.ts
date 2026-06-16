/**
 * Harry (next) — OpenAI-backed intent model.
 *
 * The real implementation of the injectable IntentModel from read-intent.ts.
 * Temperature 0 and JSON mode keep it as deterministic as a model gets; it is
 * only ever asked to classify intent, never to compute anything. Defaults to a
 * stronger model than the old gpt-4o-mini (override with HARRY_NEXT_MODEL).
 */
import OpenAI from 'openai'
import type { IntentModel } from './read-intent'

const DEFAULT_MODEL = process.env.HARRY_NEXT_MODEL || 'gpt-4o'

export function openAiIntentModel(client?: OpenAI): IntentModel {
  const openai = client ?? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

  return async ({ system, user }) => {
    const response = await openai.chat.completions.create({
      model: DEFAULT_MODEL,
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    })
    return response.choices[0]?.message?.content ?? ''
  }
}
