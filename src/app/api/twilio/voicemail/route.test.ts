import { NextRequest } from 'next/server'
import twilio from 'twilio'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { VoicemailMessage } from '@/lib/twilio/voicemail'

const mocks = vi.hoisted(() => ({
  send: vi.fn(),
  fetchCall: vi.fn(),
  writeCallLog: vi.fn(),
  rpc: vi.fn(),
  from: vi.fn(),
}))
vi.mock('resend', () => ({
  Resend: vi.fn(() => ({ emails: { send: mocks.send } })),
}))
vi.mock('twilio', async (importOriginal) => {
  const actual = await importOriginal<{ default: typeof twilio }>()
  return {
    default: Object.assign(
      vi.fn(() => ({
        calls: () => ({ fetch: mocks.fetchCall }),
      })),
      {
        validateRequest: actual.default.validateRequest,
        getExpectedTwilioSignature: actual.default.getExpectedTwilioSignature,
      },
    ),
  }
})
vi.mock('@/supabase/server', () => ({
  createAdminClient: () => ({
    from: mocks.from,
    rpc: mocks.rpc,
  }),
}))
vi.mock('@/lib/twilio/call-history', () => ({
  writeCallLog: mocks.writeCallLog,
}))
import { POST } from './route'

const account = `AC${'1'.repeat(32)}`
const callSid = `CA${'2'.repeat(32)}`
const recordingSid = `RE${'3'.repeat(32)}`
const phone = '+17195550123'
const audio = `https://api.twilio.com/2010-04-01/Accounts/${account}/Recordings/${recordingSid}`
const url = 'https://sightings.sasquatchcarpet.com/api/twilio/voicemail'
let savedMessages: VoicemailMessage[]
let storedPhone: string | null

function request(overrides: Record<string, string> = {}, signed = true) {
  const params = {
    AccountSid: account,
    CallSid: callSid,
    RecordingSid: recordingSid,
    RecordingUrl: audio,
    RecordingDuration: '3',
    RecordingStatus: 'completed',
    ...overrides,
  }
  return new NextRequest(url, {
    method: 'POST',
    body: new URLSearchParams(params),
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'x-twilio-signature': signed
        ? twilio.getExpectedTwilioSignature('test-token', url, params)
        : 'forged',
    },
  })
}

// This fake models the RPC boundary only. No Supabase or provider clients make
// network calls; production SQL merging is verified separately.
describe('voicemail recording callbacks', () => {
  beforeEach(() => {
    vi.stubEnv('TWILIO_ACCOUNT_SID', account)
    vi.stubEnv('TWILIO_AUTH_TOKEN', 'test-token')
    vi.stubEnv('TWILIO_WEBHOOK_BASE_URL', '')
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', '')
    vi.stubEnv('MISSED_CALL_AUTO_SMS_ENABLED', 'false')
    savedMessages = []
    storedPhone = phone
    vi.clearAllMocks()
    mocks.send.mockReset().mockResolvedValue({
      data: { id: 'transcript-email-1' },
      error: null,
    })
    mocks.fetchCall
      .mockReset()
      .mockResolvedValue({ direction: 'inbound', from: phone })
    mocks.writeCallLog.mockResolvedValue(undefined)
    mocks.from.mockImplementation((table: string) => {
      if (table === 'call_logs')
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: storedPhone ? { caller_phone: storedPhone } : null,
                error: null,
              }),
            }),
          }),
        }
      if (table === 'sms_logs') return { insert: async () => ({ error: null }) }
      throw new Error(`Unexpected table: ${table}`)
    })
    mocks.rpc.mockReset().mockImplementation(async (_name, args) => {
      const previous = savedMessages.find(
        (message) => message.metadata?.recording_sid === args.p_recording_sid,
      )
      const meta = previous?.metadata
      const transcript = args.p_transcription || meta?.transcription || null
      const meaningful =
        transcript &&
        ![
          '(no transcription available)',
          'no transcription',
          '(none)',
          'none',
        ].includes(transcript.trim().toLowerCase())
      const message = {
        role: 'user',
        content: 'Voicemail',
        metadata: {
          type: 'voicemail',
          recording_sid: args.p_recording_sid,
          recording_url: args.p_recording_url || meta?.recording_url || null,
          duration: args.p_duration || meta?.duration || null,
          transcription: args.p_transcription || meta?.transcription || null,
          recording_completed:
            args.p_recording_completed || meta?.recording_completed || false,
          email_sent: args.p_email_sent || meta?.email_sent || false,
          transcription_email_text:
            meta?.transcription_email_text || (meaningful ? transcript : null),
          transcription_email_id:
            meta?.transcription_email_id ||
            args.p_transcription_email_id ||
            null,
        },
      }
      savedMessages = [message]
      return {
        data: {
          conversation_id: 'correct-caller-thread',
          messages: savedMessages,
        },
        error: null,
      }
    })
  })
  afterEach(() => vi.unstubAllEnvs())

  it('saves a recording-only callback without emailing the owner', async () => {
    expect((await POST(request())).status).toBe(200)
    expect(mocks.fetchCall).not.toHaveBeenCalled()
    expect(mocks.send).not.toHaveBeenCalled()
    expect(savedMessages[0].metadata).toMatchObject({
      recording_url: `${audio}.mp3`,
      email_sent: false,
      transcription_email_id: null,
    })
    expect(mocks.writeCallLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        caller_phone: phone,
        outcome: 'voicemail',
        recording_url: `${audio}.mp3`,
      }),
    )
  })

  it('resolves omitted From through the parent call without emailing a recording-only alert', async () => {
    storedPhone = null
    expect((await POST(request())).status).toBe(200)
    expect(mocks.fetchCall).toHaveBeenCalledOnce()
    expect(mocks.rpc.mock.calls[0][1].p_phone_number).toBe(phone)
    expect(mocks.send).not.toHaveBeenCalled()
  })

  it('rejects unresolved identity rather than creating a plus-sign conversation', async () => {
    storedPhone = '+'
    mocks.fetchCall.mockResolvedValue({
      direction: 'inbound',
      from: 'anonymous',
    })
    expect((await POST(request({ From: '+' }))).status).toBe(422)
    expect(mocks.rpc).not.toHaveBeenCalled()
    expect(mocks.send).not.toHaveBeenCalled()
    expect(mocks.writeCallLog).not.toHaveBeenCalled()
  })

  it('waits through initial and completed recordings, then sends the late transcript exactly once', async () => {
    await POST(request({ RecordingStatus: '' }))
    await POST(request())
    await POST(request())
    expect(mocks.send).not.toHaveBeenCalled()
    const transcript = {
      RecordingStatus: '',
      RecordingUrl: '',
      RecordingDuration: '',
      TranscriptionStatus: 'completed',
      TranscriptionText: 'Please call me about cleaning.',
    }
    expect((await POST(request(transcript))).status).toBe(200)
    await POST(request(transcript))
    await POST(request())
    expect(mocks.send).toHaveBeenCalledOnce()
    expect(mocks.send.mock.calls[0]).toEqual([
      expect.objectContaining({
        subject: 'New voicemail from (719) 555-0123',
        text: expect.stringContaining('Please call me about cleaning.'),
        html: expect.stringContaining(`href="tel:${phone}"`),
      }),
      { idempotencyKey: `voicemail-transcription-v2/${recordingSid}` },
    ])
    expect(savedMessages).toHaveLength(1)
    expect(savedMessages[0].metadata).toMatchObject({
      recording_url: `${audio}.mp3`,
      duration: '3',
      transcription: 'Please call me about cleaning.',
      email_sent: true,
      transcription_email_id: 'transcript-email-1',
    })
  })

  it('sends one complete formatted email when the first callback already has a transcript', async () => {
    expect(
      (await POST(request({ TranscriptionText: 'Please book two rooms.' })))
        .status,
    ).toBe(200)
    expect(mocks.send).toHaveBeenCalledOnce()
    const email = mocks.send.mock.calls[0][0]
    expect(email.html).toContain('Call back (719) 555-0123')
    expect(email.html).toContain(`href="tel:${phone}"`)
    expect(email.html).toContain('Please book two rooms.')
    expect(email.html).toContain('Listen to the recording')
    expect(email.html).not.toContain('will appear')
    expect(email.text).toContain('Please book two rooms.')
    expect(email.text).toContain(`tel:${phone}`)
  })

  it('emails a completed transcript even if the recording-completion callback was missed', async () => {
    expect(
      (
        await POST(
          request({
            RecordingStatus: '',
            TranscriptionStatus: 'completed',
            TranscriptionText: 'Call me back.',
          }),
        )
      ).status,
    ).toBe(200)
    expect(mocks.send).toHaveBeenCalledOnce()
    expect(mocks.send.mock.calls[0][0].text).toContain('Call me back.')
  })

  it.each([
    '',
    '  ',
    '(No transcription available)',
    'no transcription',
    'none',
    '(none)',
  ])(
    'sends no email for a blank or placeholder transcript: %s',
    async (TranscriptionText) => {
      await POST(request({ TranscriptionText }))
      expect(mocks.send).not.toHaveBeenCalled()
      expect(savedMessages[0].metadata?.transcription_email_id).toBeNull()
    },
  )

  it('escapes caller-supplied HTML while preserving the plain-text transcript', async () => {
    const transcript = '<img src=x onerror=alert(1)> & "cleaning"'
    await POST(request({ TranscriptionText: transcript }))
    const email = mocks.send.mock.calls[0][0]
    expect(email.text).toContain(transcript)
    expect(email.html).not.toContain('<img src=x')
    expect(email.html).toContain(
      '&lt;img src=x onerror=alert(1)&gt; &amp; &quot;cleaning&quot;',
    )
  })

  it('retries rejected email without marking accepted or changing the payload', async () => {
    mocks.send.mockResolvedValueOnce({
      data: null,
      error: { message: 'Try again' },
    })
    const transcript = { TranscriptionText: 'Please call back.' }
    expect((await POST(request(transcript))).status).toBe(500)
    expect(savedMessages[0].metadata?.email_sent).toBe(false)
    expect(savedMessages[0].metadata?.transcription_email_id).toBeNull()
    expect((await POST(request(transcript))).status).toBe(200)
    expect(mocks.send).toHaveBeenCalledTimes(2)
    expect(mocks.send.mock.calls[0]).toEqual(mocks.send.mock.calls[1])
    expect(savedMessages[0].metadata?.transcription_email_id).toBe(
      'transcript-email-1',
    )
  })

  it('preserves a stable email on retry when acceptance persistence fails and later text changes', async () => {
    const merge = mocks.rpc.getMockImplementation()!
    let failMarker = true
    mocks.rpc.mockImplementation(async (name, args) => {
      if (args.p_transcription_email_id && failMarker) {
        failMarker = false
        return {
          data: null,
          error: { message: 'Database temporarily unavailable' },
        }
      }
      return merge(name, args)
    })
    expect(
      (await POST(request({ TranscriptionText: 'First transcript' }))).status,
    ).toBe(500)
    expect(savedMessages[0].metadata?.transcription_email_id).toBeNull()
    expect(
      (await POST(request({ TranscriptionText: 'Later corrected transcript' })))
        .status,
    ).toBe(200)
    expect(mocks.send.mock.calls[0]).toEqual(mocks.send.mock.calls[1])
    expect(mocks.send.mock.calls[1][0].text).toContain('First transcript')
    expect(savedMessages[0].metadata?.transcription).toBe(
      'Later corrected transcript',
    )
    expect(savedMessages[0].metadata?.transcription_email_id).toBe(
      'transcript-email-1',
    )
  })

  it('uses the same provider key and payload for overlapping transcript callbacks', async () => {
    const transcript = { TranscriptionText: 'Please call back.' }
    await Promise.all([POST(request(transcript)), POST(request(transcript))])
    expect(mocks.send).toHaveBeenCalledTimes(2)
    expect(mocks.send.mock.calls[0]).toEqual(mocks.send.mock.calls[1])
    expect(savedMessages).toHaveLength(1)
    expect(savedMessages[0].metadata?.transcription_email_id).toBe(
      'transcript-email-1',
    )
  })

  it('does not mark email accepted without a provider email id', async () => {
    mocks.send.mockResolvedValueOnce({ data: {}, error: null })
    expect(
      (await POST(request({ TranscriptionText: 'Call me.' }))).status,
    ).toBe(500)
    expect(savedMessages[0].metadata?.email_sent).toBe(false)
    expect(savedMessages[0].metadata?.transcription_email_id).toBeNull()
  })

  it('rejects forged callbacks before database or email work', async () => {
    expect(
      (await POST(request({ TranscriptionText: 'Call me.' }, false))).status,
    ).toBe(403)
    expect(mocks.from).not.toHaveBeenCalled()
    expect(mocks.rpc).not.toHaveBeenCalled()
    expect(mocks.send).not.toHaveBeenCalled()
  })
})
