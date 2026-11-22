import OpenAI from 'openai'
import { handleLiveIncoming } from './live'

export const maxDuration = 30

export async function POST(request: Request) {
  const secret = process.env.HARRY_VOICE_WEBHOOK_SECRET
  if (!secret || !process.env.OPENAI_API_KEY)
    return new Response('Unconfigured', { status: 503 })
  const client = new OpenAI({ timeout: 8000, maxRetries: 0 })
  let event
  try {
    event = await client.webhooks.unwrap(
      await request.text(),
      request.headers,
      secret,
    )
  } catch {
    return new Response('Invalid signature', { status: 403 })
  }
  return handleLiveIncoming(event, request.url, client)
}
