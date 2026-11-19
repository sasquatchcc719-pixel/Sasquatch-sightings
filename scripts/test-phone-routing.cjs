// Synthetic after-hours routing regression. Run from the repository root:
// pnpm exec tsx scripts/test-phone-routing.cjs --out /tmp/harry-routing.json
// Add --scenarios message,spam,residential to focus on closings and price turns.
// Requires OPENAI_API_KEY, ffmpeg, and macOS say or Linux espeak-ng.
// Uses provider speech generation only for Harry. Caller speech is generated locally.
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { execFileSync } = require('node:child_process')
const { parseArgs } = require('node:util')
const WS = require('ws')
const {
  previewOpening,
  turnDetector,
} = require('../src/lib/phone-assistant/preview-profile.ts')

const {
  cases,
  tools,
  prompt,
  fixture,
  evaluate,
  promptedDetail,
} = require('./fixtures/phone-routing.cjs')
function synth(line, variant) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'harry-speech-'))
  try {
    const mac = process.platform === 'darwin'
    const file = path.join(temp, mac ? 'speech.aiff' : 'speech.wav')
    if (mac)
      execFileSync('say', [
        '-v',
        variant === 1 ? 'Samantha' : 'Alex',
        '-r',
        '185',
        '-o',
        file,
        line,
      ])
    else
      execFileSync('espeak-ng', [
        '-v',
        variant === 1 ? 'en-us' : 'en-gb',
        '-s',
        '185',
        '-w',
        file,
        line,
      ])
    const trim =
      'silenceremove=start_periods=1:start_duration=0.006:start_threshold=-52dB'
    return execFileSync(
      'ffmpeg',
      [
        '-loglevel',
        'error',
        '-i',
        file,
        '-af',
        [trim, 'areverse', trim, 'areverse'].join(','),
        '-ac',
        '1',
        '-ar',
        '24000',
        '-f',
        's16le',
        'pipe:1',
      ],
      { maxBuffer: 8 * 1024 * 1024 },
    )
  } finally {
    fs.rmSync(temp, { recursive: true, force: true })
  }
}
async function run(scenario, rep) {
  const lines = [...cases[scenario][rep - 1]]
  const clips = lines.map((line) => synth(line, rep))
  const row = {
    scenario,
    rep,
    lines,
    profile: 'dispatcher-server',
    transport: 'ws',
    voice: 'cedar',
    turns: [],
    tools: [],
    responses: [],
    errors: [],
  }
  return new Promise((resolve) => {
    const ws = new WS(
      'wss://api.openai.com/v1/realtime?model=gpt-realtime-2.1',
      { headers: { Authorization: 'Bearer ' + process.env.OPENAI_API_KEY } },
    )
    const start = performance.now()
    const now = () => Math.round(performance.now() - start)
    function send(event) {
      if (ws.readyState === WS.OPEN) ws.send(JSON.stringify(event))
    }
    let current = -1
    let soundTimer
    let nextTimer
    let settled = false
    let ready = false
    const exit = (why) => {
      if (settled) return
      settled = true
      row.outcome = why
      clearTimeout(limit)
      clearTimeout(nextTimer)
      clearInterval(soundTimer)
      ws.close()
      resolve(row)
    }
    const limit = setTimeout(() => exit('timeout'), 75000)
    function input() {
      current++
      const pcm = clips[current]
      let i = 0
      const turn = { line: lines[current], start: now() }
      row.turns.push(turn)
      clearInterval(soundTimer)
      function tick() {
        const frame =
          i >= pcm.length ? Buffer.alloc(960) : pcm.subarray(i, i + 960)
        i += frame.length
        send({
          type: 'input_audio_buffer.append',
          audio: frame.toString('base64'),
        })
        if (i >= pcm.length && !turn.end) turn.end = now()
      }
      tick()
      soundTimer = setInterval(tick, 20)
    }
    ws.on('error', (e) => {
      row.errors.push(e.code ?? 'socket_error')
      exit('socket_error')
    })
    ws.on('close', () => {
      if (!settled) exit('closed')
    })
    ws.on('message', (data) => {
      if (settled) return
      const event = JSON.parse(data)
      const modelResponse = event.response
      const id = event.response_id || modelResponse?.id
      const turn = row.turns[current]
      if (event.type === 'session.created')
        send({
          type: 'session.update',
          session: {
            type: 'realtime',
            instructions: prompt,
            tools,
            audio: {
              input: {
                format: { type: 'audio/pcm', rate: 24000 },
                turn_detection: turnDetector('dispatcher-server'),
              },
              output: {
                voice: 'cedar',
                speed: 0.97,
                format: { type: 'audio/pcm', rate: 24000 },
              },
            },
          },
        })
      if (event.type === 'session.updated' && !ready) {
        ready = true
        send({
          type: 'conversation.item.create',
          item: {
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: previewOpening }],
          },
        })
        input()
        return
      }
      if (event.type === 'error') {
        row.errors.push(event.error?.code)
        row.providerError = {
          code: event.error?.code,
          param: event.error?.param,
        }
        exit('provider_error')
        return
      }
      if (event.type === 'input_audio_buffer.speech_started' && turn)
        turn.detected = now()
      if (event.type === 'input_audio_buffer.speech_stopped' && turn)
        turn.stopped = now()
      if (event.type === 'response.created')
        row.responses.push({ id, turn: current, start: now() })
      const reply = id ? row.responses.find((reply) => reply.id === id) : null
      if (event.type === 'response.output_audio.delta' && reply) {
        reply.audio ??= now()
        reply.samples =
          (reply.samples || 0) + Buffer.byteLength(event.delta, 'base64') / 2
      }
      if (event.type === 'response.output_audio_transcript.done' && reply)
        reply.text = event.transcript
      if (event.type === 'response.done' && reply) {
        reply.status = modelResponse.status
        reply.done = now()
        if (modelResponse.status !== 'completed') {
          row.errors.push(
            modelResponse.status_details?.error?.code || modelResponse.status,
          )
          exit('failed')
          return
        }
        const batch = modelResponse.output.filter(
          (item) => item.type === 'function_call',
        )
        if (batch.length) {
          let terminal = false
          for (const invocation of batch) {
            let args
            try {
              args = JSON.parse(invocation.arguments)
            } catch {
              row.errors.push('invalid_tool_json')
              exit('failed')
              return
            }
            const call = {
              turn: current,
              name: invocation.name,
              args,
              at: now(),
            }
            row.tools.push(call)
            const result = fixture(call)
            call.result = result
            send({
              type: 'conversation.item.create',
              item: {
                type: 'function_call_output',
                call_id: invocation.call_id,
                output: JSON.stringify(result),
              },
            })
            if (
              ['request_flood_confirmation', 'end_call'].includes(
                invocation.name,
              )
            )
              terminal = true
          }
          if (terminal) {
            exit('terminal-tool')
            return
          }
          if (row.tools.length > 4) {
            exit('tool-loop')
            return
          }
          // WS function tools require the fixture to request a follow-up. SIP uses hosted MCP.
          send({ type: 'response.create' })
          return
        }
        if (
          current + 1 === lines.length &&
          !row.tools.some(
            (call) =>
              call.name === 'phone_quote' &&
              typeof call.result.total === 'number',
          )
        ) {
          const detail = promptedDetail(scenario, lines, reply.text || '')
          if (detail) {
            lines.push(detail)
            clips.push(synth(detail, rep))
          }
        }
        if (current + 1 >= lines.length) {
          nextTimer = setTimeout(() => exit('replied'), 750)
          return
        }
        // Wait for the generated answer's virtual playback before sending the next caller clip.
        const gap = Math.max(
          220,
          (reply.audio ?? now()) + (reply.samples || 0) / 24 - now() + 150,
        )
        nextTimer = setTimeout(input, gap)
      }
    })
  })
}
function reportOutcome(row) {
  console.log(
    row.scenario,
    row.rep,
    row.failures.length ? 'FAIL' : 'PASS',
    row.failures.join(' / '),
  )
  if (row.failures.length) process.exitCode = 1
}
async function main() {
  const { values } = parseArgs({
    options: {
      out: { type: 'string' },
      replay: { type: 'string' },
      scenarios: { type: 'string' },
      help: { type: 'boolean' },
    },
  })
  if (values.help) {
    console.log(
      'Usage: pnpm exec tsx scripts/test-phone-routing.cjs --out REPORT.json [--scenarios ' +
        Object.keys(cases).join(',') +
        ']\nReplay a saved report offline: pnpm exec tsx scripts/test-phone-routing.cjs --replay REPORT.json',
    )
    return
  }
  if (values.replay) {
    if (values.out || values.scenarios)
      throw new Error(
        '--replay scores an existing report. Use --out and --scenarios for a new run.',
      )
    const rows = JSON.parse(fs.readFileSync(values.replay, 'utf8'))
    if (!Array.isArray(rows) || !rows.length)
      throw new Error('No trials in this report')
    for (const row of rows) {
      if (!Object.hasOwn(cases, row.scenario))
        throw new Error('Unknown recorded scenario: ' + row.scenario)
      row.failures = evaluate(row)
      reportOutcome(row)
    }
    return
  }
  if (!values.out)
    throw new Error('Choose a report path with --out REPORT.json')
  if (!process.env.OPENAI_API_KEY)
    throw new Error('Set OPENAI_API_KEY before running paid synthetic calls.')
  const scenarios = values.scenarios?.split(',') ?? Object.keys(cases)
  if (
    !scenarios.length ||
    scenarios.some((name) => !Object.hasOwn(cases, name))
  )
    throw new Error(
      'Unknown scenario. Available: ' + Object.keys(cases).join(', '),
    )
  const results = []
  const out = path.resolve(values.out)
  fs.mkdirSync(path.dirname(out), { recursive: true })
  // Exclusive creation prevents older evidence from being accidentally overwritten.
  fs.writeFileSync(out, '[]\n', { flag: 'wx' })
  for (const scenario of new Set(scenarios)) {
    for (let i = 0; i < cases[scenario].length; i++) {
      const row = await run(scenario, i + 1)
      row.failures = evaluate(row)
      row.firstAudioAfterCallerMs = row.turns.map((turn, n) => {
        const res = row.responses.find(
          (r) => r.turn === n && r.audio !== undefined,
        )
        return res && turn.end !== undefined ? res.audio - turn.end : null
      })
      results.push(row)
      fs.writeFileSync(out, JSON.stringify(results, null, 2) + '\n')
      reportOutcome(row)
    }
  }
}
main().catch((error) => {
  console.error(error.message)
  process.exitCode = 1
})
