// Run with OPENAI_API_KEY in the environment. Needs ffmpeg and macOS say or espeak.
// Uses only synthetic speech and a local fixture. Each argument is one fresh session.
// Example: node scripts/test-phone-live.mjs complete complete correction
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import WebSocket from 'ws'

const key = process.env.OPENAI_API_KEY
if (!key)
  throw new Error('Set OPENAI_API_KEY to run the isolated GPT-Live probe.')
const cases = process.argv.slice(2)
if (!cases.length) cases.push('complete', 'complete', 'correction')
if (
  cases.length > 6 ||
  cases.some((s) => !['complete', 'correction'].includes(s))
) {
  throw new Error('Choose up to six trials of complete or correction.')
}

const model = 'gpt-live-1.1'
const voice = 'cedar'
const instructions =
  "You're Harry at Sasquatch Carpet Cleaning. Listen first. Sound like a relaxed local dispatcher. For a job price or opening, delegate to the backend. Use the caller’s latest details. Give only the verified estimate and first opening. Nothing can be booked in this test."
const clips = {
  complete:
    'I need a three-seat sofa and three hundred fifty square feet of carpet cleaned. My ZIP is eight zero one three three. What would it cost, and what is the earliest opening?',
  correction:
    'I need a three-seat sofa and two hundred fifty square feet of carpet cleaned. My ZIP is eight zero one three three. What would it cost, and what is the earliest opening?',
  corrected:
    'Actually, make that three hundred fifty square feet of carpet. Same sofa and ZIP.',
}
const scratch = mkdtempSync(path.join(tmpdir(), 'harry-live-'))
function synthesize(name) {
  const mac = process.platform === 'darwin'
  const filename = path.join(scratch, name + (mac ? '.aiff' : '.wav'))
  if (mac)
    execFileSync('say', [
      '-v',
      'Samantha',
      '-r',
      '185',
      '-o',
      filename,
      clips[name],
    ])
  else execFileSync('espeak', ['-s', '185', '-w', filename, clips[name]])
  return execFileSync('ffmpeg', [
    '-loglevel',
    'error',
    '-i',
    filename,
    '-af',
    'silenceremove=start_periods=1:start_threshold=-55dB,areverse,silenceremove=start_periods=1:start_threshold=-55dB,areverse',
    '-ar',
    '24000',
    '-ac',
    '1',
    '-f',
    's16le',
    'pipe:1',
  ])
}

function hasResult(text) {
  return {
    price: /\b240\b|two[ -](?:hundred[ -](?:and[ -])?)?forty/i.test(text),
    day: /\b23(?:rd)?\b|twenty[ -]third/i.test(text),
    time: /\b11\b|eleven/i.test(text),
  }
}
function heardJob(text) {
  const normal = text
    .toLowerCase()
    .replaceAll('’', "'")
    .replace(/[-‐‑–]/g, ' ')
  return {
    sofa:
      /(?:3|three)[\s-]*seat|(?:3|three)[\s-]*cushion/.test(normal) &&
      /sofa|couch/.test(normal),
    area: /\b350\b|three hundred (?:and )?(?:fifty|50)/.test(normal),
    zip:
      /80133|eight (?:zero|oh|o) one three three/.test(
        normal.replace(/[.,-]/g, ' '),
      ) || /80133/.test(normal.replace(/[\s,-]/g, '')),
  }
}

async function trial(scenario, audio) {
  return new Promise((resolve) => {
    const started = performance.now()
    const now = () => Math.round(performance.now() - started)
    const result = {
      scenario,
      model,
      voice,
      input: [],
      output: [],
      delegations: [],
      commentary: [],
      checks: [],
      appended: [],
      eventCounts: {},
      caller: [],
      error: null,
      closedByServer: false,
      audio: { chunks: 0, firstNonSilent: null, lastNonSilent: null },
      usage: null,
    }
    const ws = new WebSocket('wss://api.openai.com/v1/live/sessions', {
      headers: { Authorization: 'Bearer ' + key },
      handshakeTimeout: 8000,
    })
    const send = (e) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(e))
    }
    let ticker,
      deadline,
      grace,
      finishTimer,
      taskTimer,
      closing = false
    let clip,
      cursor = 0,
      lastEnd,
      corrected = false,
      delivered = false,
      currentDelegation
    let outputAfterResult = ''
    const frame = Buffer.alloc(960) // 20 ms, 24 kHz mono PCM16
    function close(reason) {
      if (closing) return
      closing = true
      result.reason = reason
      clearInterval(ticker)
      clearTimeout(deadline)
      clearTimeout(taskTimer)
      clearTimeout(finishTimer)
      if (ws.readyState === WebSocket.OPEN) {
        send({ type: 'session.close' })
        grace = setTimeout(() => ws.terminate(), 3000)
      } else ws.terminate()
    }
    function startClip(name) {
      clip = { name, bytes: audio[name] }
      cursor = 0
      result.caller.push({ name, start: now() })
    }
    function answer(id, text, verified) {
      const at = now()
      const eventId = 'result_' + result.commentary.length
      result.commentary.push({ id, eventId, at, text, verified })
      send({
        type: 'session.commentary.append',
        event_id: eventId,
        delegation_id: id,
        content: text,
      })
    }
    function consider(id) {
      if (closing || delivered || currentDelegation !== id) return
      if (clip || now() - lastEnd < 900) {
        taskTimer = setTimeout(() => consider(id), 150)
        return
      }
      const context = result.input.map((p) => p.text).join('')
      const fields = heardJob(context)
      result.checks.push({ at: now(), id, fields, context })
      if (Object.values(fields).every(Boolean)) {
        delivered = true
        answer(
          id,
          'The standard estimate is $240. The earliest opening is Monday, November 23 at 11 AM.',
          true,
        )
      } else {
        answer(
          id,
          'The request does not yet match the fixture. Please clarify the missing job details.',
          false,
        )
        finishTimer = setTimeout(() => close('missing_fixture_details'), 3000)
      }
    }
    ws.on('open', () =>
      send({
        type: 'session.start',
        event_id: 'start',
        session: {
          model,
          instructions,
          audio: {
            format: { type: 'audio/pcm', rate: 24000 },
            output: { voice },
          },
          delegation: { type: 'client', acknowledgement_delay_ms: 800 },
        },
      }),
    )
    ws.on('message', (raw) => {
      const e = JSON.parse(raw)
      result.eventCounts[e.type] = (result.eventCounts[e.type] ?? 0) + 1
      if (e.type === 'session.closed') {
        result.closedByServer = true
        result.usage = e.usage
        ws.close()
        return
      }
      if (e.type === 'error' || e.type === 'session.error') {
        result.error = {
          code: e.error?.code || e.code,
          message: e.error?.message || e.message,
        }
        close('provider_error')
        return
      }
      if (closing) return
      if (e.type === 'session.started') {
        result.sessionStarted = now()
        result.resolvedModel = e.session?.model
        startClip(scenario)
        ticker = setInterval(() => {
          frame.fill(0)
          if (clip) {
            clip.bytes.copy(frame, 0, cursor, cursor + frame.length)
            cursor += frame.length
            if (cursor >= clip.bytes.length) {
              lastEnd = now()
              result.caller.at(-1).end = lastEnd
              clip = undefined
            }
          }
          send({
            type: 'session.input_audio.append',
            audio: frame.toString('base64'),
          })
        }, 20)
      } else if (
        e.type === 'session.input_transcript.delta' ||
        e.type === 'session.output_transcript.delta'
      ) {
        const input = e.type === 'session.input_transcript.delta'
        const piece = {
          at: now(),
          text: e.delta,
          startMs: e.start_ms,
          endMs: e.end_ms,
        }
        const transcript = input ? result.input : result.output
        transcript.push(piece)
        if (!input && delivered) {
          outputAfterResult += e.delta
          const verified = hasResult(outputAfterResult)
          if (Object.values(verified).some(Boolean))
            result.firstFactTranscript ??= now()
          if (Object.values(verified).every(Boolean) && !finishTimer) {
            result.allFactsTranscript = now()
            finishTimer = setTimeout(() => close('heard_result'), 2400)
          }
        }
      } else if (e.type === 'session.output_audio.delta') {
        result.audio.chunks++
        const bytes = Buffer.from(e.delta, 'base64')
        for (let pos = 0; pos + 1 < bytes.length; pos += 2) {
          if (Math.abs(bytes.readInt16LE(pos)) > 200) {
            result.audio.firstNonSilent ??= now()
            result.audio.lastNonSilent = now()
            break
          }
        }
      } else if (
        e.type === 'session.delegation.created' &&
        e.delegation.target === 'client'
      ) {
        const id = e.delegation.id
        result.delegations.push({ at: now(), id, offset: e.offset_ms })
        clearTimeout(taskTimer)
        currentDelegation = id
        send({
          type: 'session.thinking.append',
          event_id: 'quiet_' + result.delegations.length,
          delegation_id: id,
          content: '',
        })
        if (scenario === 'correction' && !corrected) {
          corrected = true
          // Simulate a caller changing a measurement while a read is pending.
          // The obsolete 250-square-foot calculation never returns a price.
          const correctWhenReady = () => {
            if (clip) taskTimer = setTimeout(correctWhenReady, 80)
            else startClip('corrected')
          }
          taskTimer = setTimeout(correctWhenReady, 300)
        } else if (!delivered) {
          taskTimer = setTimeout(() => consider(id), 900)
        }
      } else if (e.type === 'session.commentary.appended') {
        result.appended.push({ at: now(), eventId: e.client_event_id })
      }
    })
    deadline = setTimeout(() => close('deadline'), 38000)
    ws.on('error', (error) => {
      result.error = { message: error.message }
    })
    ws.on('close', (code) => {
      clearInterval(ticker)
      for (const timer of [deadline, taskTimer, grace, finishTimer])
        clearTimeout(timer)
      result.closeCode = code
      resolve(result)
    })
  })
}

try {
  const audio = Object.fromEntries(
    Object.keys(clips).map((s) => [s, synthesize(s)]),
  )
  for (const scenario of cases) {
    const result = await trial(scenario, audio)
    console.log(JSON.stringify(result))
    if (result.reason !== 'heard_result') process.exitCode = 1
    if (result.error && !result.sessionStarted) break
  }
} finally {
  rmSync(scratch, { recursive: true, force: true })
}
