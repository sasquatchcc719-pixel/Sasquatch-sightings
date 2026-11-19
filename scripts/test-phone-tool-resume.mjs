// Probe the provider-managed MCP handoff with a synthetic caller and a public,
// read-only tool. No Twilio or Sightings credentials. Only the guarded arms can request a continuation.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import WebSocket from 'ws'
import { createRequire } from 'node:module'
const { previewToolResume } = createRequire(import.meta.url)(
  './phone-tests/tool-resume.ts',
)

const key = process.env.OPENAI_API_KEY
if (!key) throw new Error('Set OPENAI_API_KEY for the isolated voice probe.')
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const modes = process.argv.slice(2)
if (!modes.length) modes.push('resume', 'interrupt')
if (modes.some((m) => !['hold', 'direct', 'resume', 'interrupt'].includes(m)))
  throw new Error('Choose hold, direct, resume, or interrupt.')
const caller = 'Can you look up the first item on the list for me?'
const scratch = mkdtempSync(path.join(tmpdir(), 'phone-resume-'))
function phoneSpeech(line) {
  const mac = process.platform === 'darwin'
  const file = path.join(scratch, mac ? 'caller.aiff' : 'caller.wav')
  execFileSync(
    mac ? 'say' : 'espeak',
    mac ? ['-v', 'Samantha', '-o', file, line] : ['-w', file, line],
  )
  return execFileSync('ffmpeg', [
    '-loglevel',
    'error',
    '-i',
    file,
    '-af',
    'silenceremove=start_periods=1:start_threshold=-50dB,areverse,silenceremove=start_periods=1:start_threshold=-50dB,areverse',
    '-ar',
    '8000',
    '-ac',
    '1',
    '-f',
    'mulaw',
    'pipe:1',
  ])
}

function trial(mode, speech, correction) {
  return new Promise((resolve) => {
    const socket = new WebSocket(
      'wss://api.openai.com/v1/realtime?model=gpt-realtime-2.1',
      { headers: { Authorization: 'Bearer ' + key }, handshakeTimeout: 8000 },
    )
    const t0 = performance.now()
    const now = () => Math.round(performance.now() - t0)
    const result = {
      mode,
      callerEndMs: null,
      toolStartMs: null,
      toolEndMs: null,
      audio: [],
      spoken: [],
      events: [],
      error: null,
    }
    const send = (e) => socket.send(JSON.stringify(e))
    const control = previewToolResume(new Set(['list_openai_docs']), () => {
      result.events.push({ type: 'test resume', ms: now() })
      send({ type: 'response.create', response: { tool_choice: 'none' } })
    })
    let interruptNow = false,
      interruptSent = false
    let listReady = false,
      sessionReady = false,
      started = false,
      closing = false,
      ticker,
      deadline
    function close() {
      if (closing) return
      closing = true
      control.dispose()
      clearInterval(ticker)
      clearTimeout(deadline)
      socket.terminate()
      resolve(result)
    }
    function startWhenReady() {
      if (closing || !sessionReady || !listReady || started) return
      started = true
      const silence = Buffer.alloc(160, 255)
      let cursor = -1600
      ticker = setInterval(() => {
        if (interruptNow && !interruptSent) {
          interruptSent = true
          speech = correction
          cursor = 0
          result.events.push({ type: 'second caller starts', ms: now() })
        }
        const buf = Buffer.from(silence)
        if (cursor >= 0 && cursor < speech.length)
          speech.copy(buf, 0, cursor, cursor + 160)
        send({
          type: 'input_audio_buffer.append',
          audio: buf.toString('base64'),
        })
        cursor += 160
        if (cursor >= speech.length && result.callerEndMs === null)
          result.callerEndMs = now()
      }, 20)
    }
    deadline = setTimeout(() => {
      if (!started) result.error = 'setup timeout'
      close()
    }, 42500)
    socket.on('error', (error) => {
      result.error = error.message
      close()
    })
    socket.on('close', () => {
      if (!closing) result.error = 'unexpected close'
      close()
    })
    socket.on('message', (raw) => {
      const e = JSON.parse(raw)
      if (mode === 'resume' || mode === 'interrupt') control.event(e)
      if (e.item?.type === 'mcp_call' || e.type.includes('mcp_call'))
        result.events.push({
          type: e.type,
          id: e.item?.id || e.item_id,
          ms: now(),
        })
      if (e.type === 'session.created')
        send({
          type: 'session.update',
          session: {
            type: 'realtime',
            instructions:
              'You answer one synthetic test caller. To answer a list question, call list_openai_docs with limit 1 and report the first actual title returned, in a single short sentence. ' +
              (mode !== 'direct'
                ? 'Briefly tell the caller you will check as you start the lookup.'
                : 'Start the lookup silently.') +
              ' Give the title when the result arrives.',
            audio: {
              input: {
                format: { type: 'audio/pcmu' },
                turn_detection: {
                  type: 'server_vad',
                  silence_duration_ms: 500,
                  idle_timeout_ms: 12000,
                  interrupt_response: true,
                  create_response: true,
                },
              },
              output: {
                voice: 'cedar',
                speed: 0.97,
                format: { type: 'audio/pcmu' },
              },
            },
            tools: [
              {
                type: 'mcp',
                server_label: 'reference_list',
                server_url: 'https://developers.openai.com/mcp',
                allowed_tools: ['list_openai_docs'],
                require_approval: 'never',
              },
            ],
          },
        })
      if (e.type === 'session.updated') sessionReady = true
      if (e.type === 'mcp_list_tools.completed') listReady = true
      if (e.type === 'mcp_list_tools.failed' || e.type === 'error') {
        result.error = e.error?.message ?? e.type
        close()
        return
      }
      if (e.type === 'response.mcp_call.in_progress') {
        result.toolStartMs = now()
        if (mode === 'interrupt') interruptNow = true
      }
      if (e.type === 'response.mcp_call.completed') result.toolEndMs = now()
      if (e.type === 'response.mcp_call.failed') result.error = 'tool failed'
      if (
        e.type === 'response.output_audio.delta' &&
        !result.audio.some(
          (a) => a.response === e.response_id && a.item === e.item_id,
        )
      )
        result.audio.push({
          response: e.response_id,
          item: e.item_id,
          ms: now(),
        })
      if (e.type === 'response.output_audio_transcript.done')
        result.spoken.push({
          response: e.response_id,
          item: e.item_id,
          ms: now(),
          text: e.transcript,
        })
      if (
        e.type === 'conversation.item.added' ||
        e.type === 'conversation.item.done'
      ) {
        if (e.item?.type === 'mcp_call' && e.item.output) {
          result.toolEndMs ??= now()
          result.events.push({
            type: 'tool output',
            ms: now(),
            output: String(e.item.output),
          })
        }
      }
      if (
        [
          'input_audio_buffer.speech_started',
          'input_audio_buffer.speech_stopped',
          'input_audio_buffer.timeout_triggered',
          'response.created',
          'response.done',
          'response.mcp_call.completed',
          'response.mcp_call.failed',
        ].includes(e.type)
      )
        result.events.push({
          type: e.type,
          ms: now(),
          status: e.response?.status,
          reason: e.response?.status_details?.error?.code,
        })
      startWhenReady()
      if (
        mode === 'interrupt' &&
        e.type === 'response.done' &&
        result.spoken.some((s) => /four|\b4\b/i.test(s.text))
      )
        close()
      if (
        mode !== 'interrupt' &&
        result.toolEndMs &&
        result.spoken.some(
          (s) =>
            s.ms > result.toolEndMs &&
            !/^(one moment|i.ll check)[.!]?$/i.test(s.text),
        ) &&
        e.type === 'response.done'
      )
        close()
    })
  })
}
try {
  const speech = phoneSpeech(caller)
  const correction = phoneSpeech(
    'Actually, skip that list. Tell me what two plus two is instead.',
  )
  for (let rep = 1; rep <= 3; rep++)
    for (const mode of modes) {
      const row = await trial(mode, speech, correction)
      const tool = row.events.find((e) => e.type === 'tool output')
      const title = tool && JSON.parse(tool.output)?.hits?.[0]?.hierarchy?.lvl1
      const normalize = (t) =>
        t
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, ' ')
          .trim()
      const answer =
        title &&
        row.spoken.find((s) => normalize(s.text).includes(normalize(title)))
      const first = answer && row.audio.find((a) => a.item === answer.item)
      const afterResultMs = first && first.ms - row.toolEndMs
      const reasons = []
      if (row.error) reasons.push(row.error)
      if (!row.toolEndMs || !title)
        reasons.push('No verified hosted tool result')
      if (mode === 'interrupt') {
        if (!row.spoken.some((s) => /four|\b4\b/i.test(s.text)))
          reasons.push('Missed correction')
        if (answer) reasons.push('Announced superseded result')
      } else {
        if (!answer) reasons.push('Missing verified answer')
        if (afterResultMs > 3000)
          reasons.push(
            'Answer began more than three seconds after the tool result',
          )
      }
      console.log(JSON.stringify({ rep, ...row, afterResultMs, reasons }))
      if (reasons.length) process.exitCode = 1
      await wait(250)
    }
} finally {
  rmSync(scratch, { recursive: true, force: true })
}
