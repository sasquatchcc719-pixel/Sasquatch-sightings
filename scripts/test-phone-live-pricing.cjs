// Real read-only Sightings pricing and availability through managed GPT-Live Responses.
// From the repository root, supply OPENAI_API_KEY, NEXT_PUBLIC_SUPABASE_URL and
// SUPABASE_SERVICE_ROLE_KEY in the environment, then run once with:
// pnpm exec tsx scripts/test-phone-live-pricing.cjs
// ffmpeg and either macOS say or espeak are required. The report and generated
// agent audio are written to a new private temp directory, printed at startup.
// Compare the spoken transcript to the returned date/time and quote in the report.
const fs = require('node:fs'),
  path = require('node:path'),
  os = require('node:os'),
  cp = require('node:child_process'),
  crypto = require('node:crypto')
const local = require('node:module').createRequire(path.resolve('package.json'))
const { WebSocket } = local('ws'),
  { z } = local('zod')
for (const key of [
  'OPENAI_API_KEY',
  'NEXT_PUBLIC_SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
]) {
  if (!process.env[key]?.trim())
    throw new Error('Missing environment variable ' + key)
}
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'harry-live-pricing-'))
console.log('Synthetic trial artifacts:', outDir)
const sitOrigin = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL.trim()).origin
// A throwaway quote-signing key is private to the synthetic session.
process.env.HARRY_VOICE_WEBHOOK_SECRET = crypto.randomBytes(32).toString('hex')
const fetchOrig = globalThis.fetch
const allowedTables = new Set([
  'service_catalog_items',
  'staff_users',
  'staff_daily_availability',
  'availability_templates',
  'availability_overrides',
  'ops_appointments',
  'ops_calendar_events',
])
const counts = {}
globalThis.fetch = async (input, init) => {
  const url = new URL(
    typeof input === 'string' || input instanceof URL ? input : input.url,
  )
  const table = url.pathname.match(/^\/rest\/v1\/([a-z_]+)$/)?.[1]
  const method = (init?.method || input?.method || 'GET').toUpperCase()
  if (
    url.origin !== sitOrigin ||
    !['GET', 'HEAD'].includes(method) ||
    !allowedTables.has(table)
  )
    throw Error('Unapproved database read or non-read method')
  counts[table] = (counts[table] || 0) + 1
  return await fetchOrig(input, { ...init, redirect: 'error' })
}
const { createAdminClient } = local('./src/supabase/server.ts')
const { loadBookableCatalog } = local('./src/lib/ops/bookable-catalog.ts')
const { runPhoneTool, previewPhoneTools } = local(
  './src/lib/phone-assistant/engine.ts',
)
const { liveVoiceSession } = local('./src/lib/phone-assistant/live-preview.ts')
const { coachingTopics } = local('./src/lib/phone-assistant/coaching.ts')
const { catalogServiceCodes, previewToolResult } = local(
  './src/lib/phone-assistant/preview-profile.ts',
)
const clock = () => performance.now(),
  pause = (ms) => new Promise((r) => setTimeout(r, ms))
const spoken =
  'I need my three-seat sofa cleaned, and the carpet in one living room. The living room is three hundred fifty square feet. My ZIP code is eight zero one three three. How much is that, and what is the earliest appointment?'
function makeSpeech() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'harry-live-synthetic-'))
  try {
    const mac = process.platform === 'darwin'
    const a = path.join(tmp, mac ? 'caller.aiff' : 'caller.wav')
    if (mac)
      cp.execFileSync('say', ['-v', 'Samantha', '-r', '174', '-o', a, spoken])
    else
      cp.execFileSync('espeak', ['-v', 'en-us', '-s', '174', '-w', a, spoken])
    const b = cp.execFileSync('ffmpeg', [
      '-loglevel',
      'error',
      '-i',
      a,
      '-ar',
      '24000',
      '-ac',
      '1',
      '-f',
      's16le',
      'pipe:1',
    ])
    let start = 0,
      end = b.length - 2
    while (start < end && Math.abs(b.readInt16LE(start)) < 140) start += 2
    while (end > start && Math.abs(b.readInt16LE(end)) < 140) end -= 2
    return b.subarray(Math.max(0, start - 144), end + 2)
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
}
function publicResult(result) {
  if (!result || result.error)
    return { error: result?.error || 'The calendar did not return a result.' }
  const q = result.quote
  return {
    date: result.date,
    timezone: result.timezone,
    first_available_time: result.times?.[0] ?? null,
    quote: q
      ? {
          status: q.status,
          total: q.total,
          lines: q.lines,
          duration_minutes: q.duration_minutes,
          minimum_charge_applied: q.minimum_charge_applied,
        }
      : null,
  }
}
function guardRead(name, args, tool) {
  if (name !== 'phone_openings') throw Error('Tool is outside read-only scope')
  const parsed = tool.inputSchema.parse(args)
  if (
    parsed.visit_type !== 'residential_service' ||
    !parsed.service ||
    parsed.service.coupon_code ||
    parsed.service.lead_source ||
    parsed.service.lead_detail
  )
    throw Error(
      'This private trial supports ordinary residential opening reads only',
    )
  return parsed
}
function audioActive(buf) {
  let ss = 0,
    n = 0
  for (let i = 0; i + 1 < buf.length; i += 8) {
    const x = buf.readInt16LE(i)
    ss += x * x
    n++
  }
  return n && Math.sqrt(ss / n) > 120
}
async function run(id, synthetic, schema, session) {
  const report = {
    id,
    caller: spoken,
    clock: 'monotonic milliseconds from WebSocket connection request',
    voice: session.audio.output.voice,
    liveModel: session.model,
    backend: session.delegation.responses.model,
    delegateMode: 'responses',
    delegations: [],
    calls: [],
    inputText: [],
    outputText: [],
    backendText: [],
    lifecycle: [],
    errors: [],
    audioActiveSpans: [],
    dbReads: {},
  }
  const before = { ...counts },
    start = clock(),
    now = () => Math.round(clock() - start)
  const socket = new WebSocket('wss://api.openai.com/v1/live/sessions', {
    headers: {
      Authorization: 'Bearer ' + process.env.OPENAI_API_KEY.trim(),
      'OpenAI-Safety-Identifier': crypto
        .createHash('sha256')
        .update('sasquatch-private-synthetic-probe')
        .digest('hex'),
    },
  })
  const send = (e) => {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(e))
  }
  const ctx = {
    callSid: 'private-live-' + crypto.randomUUID(),
    callerPhone: '',
    preview: true,
  }
  let finished = false,
    closing = false,
    guard,
    closeTimer,
    status,
    streaming = false,
    lastText = 0,
    backendFinished = 0,
    activeUntil = 0,
    toolAttempts = 0,
    serverStarted = false
  let buffers = [],
    outputBytes = 0,
    tail = Promise.resolve()
  const readTool = {
    type: 'function',
    name: schema.name,
    description: schema.description,
    strict: false,
    parameters: z.toJSONSchema(schema.inputSchema),
  }
  // Preserve both candidate prompts. Replace SIP/MCP transport with local PCM
  // and the one permitted, schema-validated availability read. The caller
  // speaks first, so the SIP startup greeting is deliberately omitted.
  const connectionSession = {
    model: session.model,
    instructions: session.instructions,
    audio: { ...session.audio, format: { type: 'audio/pcm', rate: 24000 } },
    delegation: {
      ...session.delegation,
      responses: {
        ...session.delegation.responses,
        tools: [readTool],
      },
    },
  }
  report.promptHashes = Object.fromEntries(
    [
      ['voice', session.instructions],
      ['backend', session.delegation.responses.instructions],
    ].map(([key, value]) => [
      key,
      crypto.createHash('sha256').update(value).digest('hex'),
    ]),
  )
  function stop(reason) {
    if (finished || closing) return
    status = reason
    closing = true
    streaming = false
    if (!serverStarted) {
      socket.terminate()
      return
    }
    send({ type: 'session.close' })
    closeTimer = setTimeout(() => socket.terminate(), 4000)
  }
  return new Promise((resolve) => {
    function finish() {
      if (finished) return
      finished = true
      streaming = false
      clearTimeout(guard)
      clearTimeout(closeTimer)
      report.status = status || 'transport_closed'
      report.outputAudioBytes = outputBytes
      report.dbReads = Object.fromEntries(
        Object.entries(counts)
          .map(([k, v]) => [k, v - (before[k] || 0)])
          .filter(([, v]) => v),
      )
      report.finished = now()
      if (buffers.length) {
        cp.execFileSync(
          'ffmpeg',
          [
            '-y',
            '-loglevel',
            'error',
            '-f',
            's16le',
            '-ar',
            '24000',
            '-ac',
            '1',
            '-i',
            'pipe:0',
            '-codec:a',
            'libmp3lame',
            '-q:a',
            '4',
            path.join(outDir, id + '-agent.mp3'),
          ],
          { input: Buffer.concat(buffers) },
        )
      }
      fs.writeFileSync(
        path.join(outDir, id + '.json'),
        JSON.stringify(report, null, 2),
      )
      console.log(
        id,
        report.status,
        report.errors,
        report.calls.map((c) => ({ name: c.name, result: c.result })),
        report.outputText.map((t) => t.text).join(''),
      )
      resolve(report)
    }
    async function stream() {
      streaming = true
      const initial = Buffer.alloc(450 * 48),
        voice = Buffer.concat([initial, synthetic])
      const base = clock()
      for (let index = 0; streaming; index++) {
        const offset = index * 960
        await pause(Math.max(0, base + index * 20 - clock()))
        if (!streaming) break
        const frame = Buffer.alloc(960)
        if (offset < voice.length)
          voice.copy(frame, 0, offset, Math.min(offset + 960, voice.length))
        send({
          type: 'session.input_audio.append',
          audio: frame.toString('base64'),
        })
        if (offset <= voice.length && offset + 960 > voice.length)
          report.callerEnd = now()
        if (
          backendFinished &&
          now() - backendFinished > 6500 &&
          now() - lastText > 2600 &&
          now() - activeUntil > 800 &&
          report.calls.length
        )
          stop('done')
        if (report.callerEnd && now() - report.callerEnd > 42000)
          stop('response_timeout')
      }
    }
    async function execute(item) {
      const call = { name: item.name, received: now() }
      report.calls.push(call)
      if (++toolAttempts > 2) {
        stop('tool_budget')
        return
      }
      try {
        call.args = JSON.parse(item.arguments)
        const args = guardRead(item.name, call.args, schema)
        call.normalized = args
        const result = await runPhoneTool(item.name, args, ctx)
        call.result = publicResult(result)
        call.modelResult = previewToolResult(item.name, result)
      } catch (e) {
        call.result = {
          error: 'The supplied read-only request could not be verified.',
        }
        call.issue = e.name
      }
      call.completed = now()
      send({
        type: 'response.item.create',
        item: {
          type: 'function_call_output',
          call_id: item.call_id,
          output: JSON.stringify(call.modelResult ?? call.result),
        },
      })
      send({ type: 'response.create' })
    }
    guard = setTimeout(() => stop('trial_timeout'), 64000)
    socket.on('open', () =>
      send({ type: 'session.start', session: connectionSession }),
    )
    socket.on('message', (raw) => {
      if (finished) return
      const e = JSON.parse(raw)
      const t = now()
      if (e.type === 'session.started') {
        serverStarted = true
        report.started = t
        report.resolved = {
          model: e.session?.model,
          voice: e.session?.audio?.output?.voice,
          backend: e.session?.delegation?.responses?.model,
        }
        void stream()
      } else if (e.type === 'session.delegation.created') {
        report.delegations.push({
          t,
          target: e.delegation?.target || e.target,
          response_id: e.delegation?.response_id || e.response_id,
        })
      } else if (
        e.type === 'session.input_transcript.delta' ||
        e.type === 'session.output_transcript.delta'
      ) {
        const input = e.type.includes('input_')
        report[input ? 'inputText' : 'outputText'].push({
          t,
          text: e.delta,
          startMs: e.start_ms,
          endMs: e.end_ms,
        })
        if (!input) lastText = t
      } else if (e.type === 'session.output_audio.delta') {
        const b = Buffer.from(e.delta, 'base64')
        outputBytes += b.length
        buffers.push(b)
        if (audioActive(b)) {
          const prior = report.audioActiveSpans.at(-1)
          if (!prior || t - prior.end > 200)
            report.audioActiveSpans.push({ start: t, end: t })
          else prior.end = t
          activeUntil = t
        }
      } else if (e.type === 'response.event') {
        const n = e.event
        if (!n) return
        if (
          [
            'response.created',
            'response.completed',
            'response.failed',
            'response.incomplete',
          ].includes(n.type)
        )
          report.lifecycle.push({
            t,
            type: n.type,
            reason: n.response?.incomplete_details?.reason,
          })
        if (
          n.type === 'response.output_item.done' &&
          n.item?.type === 'function_call'
        ) {
          tail = tail
            .then(() => execute(n.item))
            .catch(() => stop('tool_dispatch_error'))
        }
        if (n.type === 'response.output_text.delta')
          report.backendText.push({ t, text: n.delta })
        if (n.type === 'response.completed' && report.backendText.length)
          backendFinished = t
        if (n.type === 'response.failed') {
          report.errors.push({ t, code: n.response?.error?.code })
          stop('backend_failed')
        }
      } else if (e.type === 'error') {
        report.errors.push({
          t,
          code: e.error?.code,
          message: String(e.error?.message || '')
            .replace(/org-[\w-]+/g, '[redacted]')
            .slice(0, 300),
        })
        stop('provider_error')
      } else if (e.type === 'session.closed') {
        report.closed = t
        socket.close()
      }
    })
    socket.on('unexpected-response', (r, res) => {
      report.errors.push({ httpStatus: res.statusCode })
      status = 'handshake_failed'
      res.resume()
      socket.terminate()
    })
    socket.on('error', (e) => {
      report.errors.push({
        kind: 'transport',
        message: String(e.message)
          .replace(/org-[\w-]+/g, '[redacted]')
          .slice(0, 120),
      })
    })
    socket.on('close', finish)
  })
}
;(async () => {
  const db = createAdminClient()
  const rows = await loadBookableCatalog(db)
  if (!rows.length) throw Error('Empty public catalog')
  const codes = catalogServiceCodes(rows)
  // The three staff-authored coaching topics in the original captured probe
  // are enough to replay this case without reading any historical caller data.
  const reminders = ['repeat_question', 'early_source', 'unwanted_offer'].map(
    (key) => coachingTopics[key].reminder,
  )
  const coaching =
    '\nConversation reminders from recent call reviews:\n' +
    reminders.join('\n')
  const session = liveVoiceSession(rows, coaching, {
    server_url: 'https://unused.invalid',
    authorization: '',
    allowed_tools: ['phone_openings'],
  })
  const schema = previewPhoneTools(rows).find(
    (t) => t.name === 'phone_openings',
  )
  const synthetic = makeSpeech()
  const id = 'synthetic-earliest'
  console.log(
    'Prepared',
    rows.length,
    'public items; authorized tool:',
    schema.name,
    'synthetic speech length:',
    Math.round(synthetic.length / 48),
    'ms',
  )
  const report = await run(id, synthetic, schema, session)
  const call = report.calls[0]
  const result = call?.result
  const service = call?.args?.service
  const wantedCodes = [
    'sofa-couch-3-seat',
    'sasquatch-size-room-200-to-400-sqft',
  ]
  const wantedIds = wantedCodes.map((code) => codes.get(code))
  const actualLines = call?.normalized?.service?.line_items ?? []
  const correctJob =
    call?.args?.zip_code === '80133' &&
    service?.zip_code === '80133' &&
    !call.args.appointment_date &&
    !call.args.search_from &&
    wantedIds.every(
      (id) =>
        id &&
        actualLines.some(
          (line) => line.service_id === id && line.quantity === 1,
        ),
    ) &&
    actualLines.length === 2
  if (
    report.status !== 'done' ||
    !correctJob ||
    !Number.isFinite(result?.quote?.total) ||
    !result?.first_available_time ||
    !result.date ||
    !report.outputText.length
  ) {
    throw new Error(
      'The synthetic job did not produce a verified quote, opening and voice response. Inspect the report.',
    )
  }
})().catch((e) => {
  console.error(e.name, e.message)
  process.exitCode = 1
})
