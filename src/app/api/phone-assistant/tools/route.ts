import {
  createMcpHandler,
  McpServer,
  type ServerContext,
} from '@modelcontextprotocol/server'
import { z } from 'zod'
import { escapeTwiml } from '@/lib/twilio/forward-twiml'
import { verifyCallToken } from '@/lib/phone-assistant/call-token'
import { phoneToolsForCall, runPhoneTool } from '@/lib/phone-assistant/engine'
import { createAdminClient } from '@/supabase/server'
import { loadBookableCatalog } from '@/lib/ops/bookable-catalog'
import { dispatcherToolResult } from '@/lib/phone-assistant/dispatcher-instructions'
import {
  getVoiceSessionDetails,
  latestCallerTurn,
  claimVoiceExit,
  finishVoiceExit,
} from '@/lib/phone-assistant/records'
import { queueBaseUrl, queueClient } from '@/lib/twilio/appointment-queue'

export const maxDuration = 120

export async function POST(request: Request) {
  const bearer = request.headers
    .get('authorization')
    ?.match(/^Bearer (\S+)$/i)?.[1]
  const callSid = bearer && verifyCallToken(bearer, 'tools')
  if (!callSid) return new Response('Unauthorized', { status: 401 })
  const session = await getVoiceSessionDetails(callSid)
  if (!session || session.status !== 'active' || !session.providerCallId)
    return new Response('Call is inactive', { status: 403 })

  const authorizedSid = callSid
  const discard = () => ({
    content: [
      {
        type: 'text' as const,
        text: 'Obsolete tool turn. Discard this result silently and follow the latest caller request.',
      },
    ],
  })
  async function fresh(
    signal: AbortSignal,
    run: (freshness: {
      expectedCallerSequence: number | null
      isCurrent: () => Promise<boolean>
    }) => Promise<{
      content: { type: 'text'; text: string }[]
      isError?: boolean
      committed?: boolean
    }>,
    exit = false,
  ) {
    const cancelled = () => signal.aborted || request.signal.aborted
    if (cancelled()) return discard()
    const sequence = await latestCallerTurn(authorizedSid)
    const isCurrent = async () => {
      if (cancelled()) return false
      const [current, details] = await Promise.all([
        latestCallerTurn(authorizedSid),
        getVoiceSessionDetails(authorizedSid),
      ])
      return (
        !cancelled() && current === sequence && details?.status === 'active'
      )
    }
    if (cancelled()) return discard()
    if (exit) {
      if (!(await claimVoiceExit(authorizedSid))) return discard()
      if (!(await isCurrent())) {
        await finishVoiceExit(authorizedSid, false)
        return discard()
      }
      const result = await run({ expectedCallerSequence: sequence, isCurrent })
      await finishVoiceExit(authorizedSid, true)
      return result
    }
    const { committed, ...result } = await run({
      expectedCallerSequence: sequence,
      isCurrent,
    })
    // An interruption can supersede a quote, but can't undo a committed job.
    // Preserve its receipt even when a later turn arrived or the next read fails.
    return committed || (await isCurrent()) ? result : discard()
  }
  const context = {
    callSid,
    callerPhone: session.callerPhone,
    preview: session.pilot,
  }
  const availableTools = phoneToolsForCall(
    session.pilot,
    await loadBookableCatalog(
      createAdminClient(),
      AbortSignal.timeout(600),
    ).catch(() => []),
  )
  const handler = createMcpHandler(
    () => {
      const server = new McpServer({
        name: 'sasquatch-phone',
        version: '1.0.0',
      })
      for (const tool of availableTools) {
        server.registerTool(
          tool.name,
          { description: tool.description, inputSchema: tool.inputSchema },
          async (input: unknown, extra: ServerContext) =>
            fresh(extra.mcpReq.signal, async (freshness) => {
              try {
                const result = await runPhoneTool(
                  tool.name,
                  input as Record<string, unknown>,
                  { ...context, ...freshness },
                )
                return {
                  committed: Boolean(
                    (tool.name === 'phone_book_service' ||
                      tool.name === 'phone_book_measurement') &&
                    result &&
                    typeof result === 'object' &&
                    'status' in result &&
                    result.status === 'booked' &&
                    'appointment_id' in result &&
                    result.appointment_id &&
                    'confirmation_number' in result &&
                    result.confirmation_number,
                  ),
                  ...(result && typeof result === 'object' && 'error' in result
                    ? { isError: true }
                    : {}),
                  content: [
                    {
                      type: 'text' as const,
                      text: JSON.stringify(
                        dispatcherToolResult(tool.name, result),
                      ),
                    },
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
            }),
        )
      }
      server.registerTool(
        'request_flood_confirmation',
        {
          description:
            'For an active flood or water actively entering a property, ask the caller to confirm with the emergency keypad. Only that explicit confirmation can ring staff. A request for a person is a callback message.',
          inputSchema: z.object({}),
        },
        async (_input, extra) =>
          fresh(
            extra.mcpReq.signal,
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
            true,
          ),
      )
      server.registerTool(
        'end_call',
        {
          description:
            'End this call after saying goodbye, including after politely declining a sales pitch.',
          inputSchema: z.object({}),
        },
        async (_input, extra) =>
          fresh(
            extra.mcpReq.signal,
            async () => {
              await queueClient()
                .calls(callSid)
                .update({ twiml: '<Response><Hangup/></Response>' })
              return { content: [{ type: 'text', text: 'Call ended.' }] }
            },
            true,
          ),
      )
      return server
    },
    { legacy: 'stateless', responseMode: 'json', maxRequestBodySize: 32768 },
  )
  return handler.fetch(request)
}
