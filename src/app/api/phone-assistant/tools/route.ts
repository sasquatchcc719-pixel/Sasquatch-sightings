import { createMcpHandler, McpServer } from '@modelcontextprotocol/server'
import { z } from 'zod'
import { escapeTwiml } from '@/lib/twilio/forward-twiml'
import { verifyCallToken } from '@/lib/phone-assistant/call-token'
import { phoneTools, runPhoneTool } from '@/lib/phone-assistant/engine'
import { getVoiceSession } from '@/lib/phone-assistant/records'
import { queueBaseUrl, queueClient } from '@/lib/twilio/appointment-queue'

export async function POST(request: Request) {
  const bearer = request.headers
    .get('authorization')
    ?.match(/^Bearer (\S+)$/i)?.[1]
  const callSid = bearer && verifyCallToken(bearer, 'tools')
  if (!callSid) return new Response('Unauthorized', { status: 401 })
  const session = await getVoiceSession(callSid)
  if (!session || session.status !== 'active' || !session.providerCallId)
    return new Response('Call is inactive', { status: 403 })

  const context = {
    callSid,
    callerPhone: session.callerPhone,
    preview: session.pilot,
  }
  const handler = createMcpHandler(
    () => {
      const server = new McpServer({
        name: 'sasquatch-phone',
        version: '1.0.0',
      })
      for (const tool of phoneTools) {
        server.registerTool(
          tool.name,
          { description: tool.description, inputSchema: tool.inputSchema },
          async (input: unknown) => {
            try {
              const result = await runPhoneTool(
                tool.name,
                input as Record<string, unknown>,
                context,
              )
              return {
                content: [
                  { type: 'text' as const, text: JSON.stringify(result) },
                ],
              }
            } catch {
              console.error(
                '[Phone assistant] Customer tool unavailable',
                callSid,
                tool.name,
              )
              return {
                isError: true,
                content: [
                  {
                    type: 'text' as const,
                    text: 'Lookup failed. Offer to take a message. Never confirm an unverified price or booking.',
                  },
                ],
              }
            }
          },
        )
      }
      server.registerTool(
        'request_flood_confirmation',
        {
          description:
            'For an active flood or water actively entering a property, ask the caller to confirm with the emergency keypad. Only that explicit confirmation can ring staff. A request for a person is a callback message.',
          inputSchema: z.object({}),
        },
        async () => {
          const menu = session.pilot ? 'harry-preview' : 'harry-public'
          await queueClient()
            .calls(callSid)
            .update({
              twiml:
                '<Response><Stop><Transcription name="harry"/></Stop><Redirect method="POST">' +
                escapeTwiml(
                  queueBaseUrl() +
                    '/api/twilio/ivr-menu?context=' +
                    menu +
                    '&flood=prompt',
                ) +
                '</Redirect></Response>',
            })
          return {
            content: [
              {
                type: 'text',
                text: 'Emergency keypad confirmation requested.',
              },
            ],
          }
        },
      )
      server.registerTool(
        'end_call',
        {
          description:
            'End this call after saying goodbye, including after politely declining a sales pitch.',
          inputSchema: z.object({}),
        },
        async () => {
          await queueClient()
            .calls(callSid)
            .update({ twiml: '<Response><Hangup/></Response>' })
          return { content: [{ type: 'text', text: 'Call ended.' }] }
        },
      )
      return server
    },
    { legacy: 'stateless', responseMode: 'json', maxRequestBodySize: 32768 },
  )
  return handler.fetch(request)
}
