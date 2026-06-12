/**
 * Minimal Zapier MCP client for Echo delivery.
 *
 * Posts to Google Business Profile (and Facebook, when the page becomes
 * reachable) through the user's own Zapier MCP server via JSON-RPC over HTTP.
 * This replaced the old "fire a webhook at a Zapier Zap" delivery, which broke
 * permanently on expiring signed image URLs.
 *
 * Auth is the token embedded in ZAPIER_MCP_URL. Each call is self-contained
 * (initialize + tools/call) so it works in stateless serverless invocations.
 */

const ZAPIER_MCP_URL = process.env.ZAPIER_MCP_URL

export type ZapierExecuteResult = {
  ok: boolean
  detail: string
}

async function rpc(
  method: string,
  params: Record<string, unknown>,
  id: number,
): Promise<unknown> {
  const res = await fetch(ZAPIER_MCP_URL as string, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
  })
  const text = await res.text()
  // Responses may arrive as an SSE frame ("data: {...}") or plain JSON.
  const dataLine = text.split('\n').find((l) => l.startsWith('data: '))
  try {
    return JSON.parse(dataLine ? dataLine.slice(6) : text)
  } catch {
    return { _raw: text.slice(0, 500), _status: res.status }
  }
}

/**
 * Execute a Zapier write action (create post / reply / etc.) and report
 * whether it succeeded. `params` must include every required field so the
 * action does not stop to ask a follow-up question.
 */
export async function zapierExecute(
  selectedApi: string,
  action: string,
  params: Record<string, unknown>,
  instructions: string,
): Promise<ZapierExecuteResult> {
  if (!ZAPIER_MCP_URL) {
    return { ok: false, detail: 'ZAPIER_MCP_URL not configured' }
  }

  try {
    await rpc(
      'initialize',
      {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: { name: 'sasquatch-echo', version: '1.0' },
      },
      1,
    )

    const out = (await rpc(
      'tools/call',
      {
        name: 'execute_zapier_write_action',
        arguments: {
          selected_api: selectedApi,
          action,
          instructions,
          params,
          output: 'Whether it succeeded, plus any id/url/state.',
        },
      },
      2,
    )) as {
      result?: { content?: Array<{ text?: string }>; isError?: boolean }
      error?: unknown
    }

    if (out.error) {
      return { ok: false, detail: JSON.stringify(out.error).slice(0, 500) }
    }
    const text = out.result?.content?.[0]?.text ?? JSON.stringify(out)

    // The action stalls instead of posting when a required field is missing.
    if (/followUpQuestion/i.test(text)) {
      return {
        ok: false,
        detail: 'Action asked a follow-up question — missing a required field',
      }
    }
    const succeeded =
      /"created_successfully"\s*:\s*true/i.test(text) ||
      /"status"\s*:\s*"SUCCESS"/i.test(text)
    const errored =
      out.result?.isError === true ||
      /"status"\s*:\s*"(ERROR|FAILED)"/i.test(text) ||
      /"error"\s*:/i.test(text)

    return { ok: succeeded && !errored, detail: text.slice(0, 600) }
  } catch (err) {
    return {
      ok: false,
      detail: err instanceof Error ? err.message : String(err),
    }
  }
}
