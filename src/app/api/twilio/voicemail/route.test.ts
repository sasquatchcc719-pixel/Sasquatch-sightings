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
    mocks.send.mockReset().mockImplementation(async (email) => ({
      data: {
        id: email.subject.startsWith('Voicemail transcription')
          ? 'transcript-email-1'
          : 'email-1',
      },
      error: null,
    }))
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

  it('resolves a callback without From to the stored caller and alerts without a transcript', async () => {
    expect((await POST(request())).status).toBe(200)
    expect(mocks.rpc).toHaveBeenCalledWith(
      'merge_voicemail_callback',
      expect.objectContaining({
        p_phone_number: phone,
        p_recording_sid: recordingSid,
        p_recording_completed: true,
      }),
    )
    expect(mocks.fetchCall).not.toHaveBeenCalled()
    expect(mocks.send).toHaveBeenCalledTimes(1)
    expect(mocks.send.mock.calls[0][1]).toEqual({
      idempotencyKey: `voicemail-recording/${recordingSid}`,
    })
    expect(mocks.send.mock.calls[0][0].html).not.toContain(
      'did not leave a message',
    )
    expect(savedMessages[0].metadata?.email_sent).toBe(true)
    expect(mocks.writeCallLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        caller_phone: phone,
        outcome: 'voicemail',
        recording_url: `${audio}.mp3`,
      }),
    )
  })

  it('uses the Twilio inbound parent when the stored caller is absent', async () => {
    storedPhone = null
    expect((await POST(request())).status).toBe(200)
    expect(mocks.fetchCall).toHaveBeenCalledOnce()
    expect(mocks.rpc.mock.calls[0][1].p_phone_number).toBe(phone)
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

  it('stores an initial Record action but waits for final recording completion to alert', async () => {
    expect((await POST(request({ RecordingStatus: '' }))).status).toBe(200)
    expect(mocks.send).not.toHaveBeenCalled()
    expect((await POST(request())).status).toBe(200)
    expect(mocks.send).toHaveBeenCalledOnce()
  })

  it('emails the late transcript once without repeating the recording alert or losing audio', async () => {
    await POST(request())
    await POST(request())
    await POST(
      request({
        RecordingStatus: '',
        RecordingUrl: '',
        RecordingDuration: '',
        TranscriptionStatus: 'completed',
        TranscriptionText: 'Please call me about cleaning.',
      }),
    )
    await POST(request())
    expect(mocks.send).toHaveBeenCalledTimes(2)
    expect(mocks.send.mock.calls[1]).toEqual([
      expect.objectContaining({
        subject: `Voicemail transcription from ${phone}`,
        text: expect.stringContaining('Please call me about cleaning.'),
      }),
      { idempotencyKey: `voicemail-transcription/${recordingSid}` },
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

  it('emails a transcript already present when the recording completes', async () => {
    expect(
      (await POST(request({ TranscriptionText: 'Please book two rooms.' })))
        .status,
    ).toBe(200)
    expect(mocks.send).toHaveBeenCalledTimes(2)
    expect(mocks.send.mock.calls[1][0].text).toContain('Please book two rooms.')
  })

  it('emails a completed transcription even if the recording-completion callback was missed', async () => {
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
    expect(
      mocks.send.mock.calls.some(([email]) =>
        email.text?.includes('Call me back.'),
      ),
    ).toBe(true)
  })

  it.each(['', '(No transcription available)', 'none', '(none)'])(
    'does not email a placeholder transcript: %s',
    async (TranscriptionText) => {
      await POST(request({ TranscriptionText }))
      expect(mocks.send).toHaveBeenCalledOnce()
      expect(savedMessages[0].metadata?.transcription_email_id).toBeNull()
    },
  )

  it('puts caller-supplied transcript text in a plain-text email', async () => {
    const transcript = '<img src=x onerror=alert(1)> & cleaning'
    await POST(request({ TranscriptionText: transcript }))
    expect(mocks.send.mock.calls[1][0].text).toContain(transcript)
    expect(mocks.send.mock.calls[1][0].html).toBeUndefined()
  })

  it('retries a rejected transcript without repeating the accepted recording alert', async () => {
    await POST(request())
    mocks.send.mockResolvedValueOnce({
      data: null,
      error: { message: 'Try again' },
    })
    const transcript = {
      RecordingStatus: '',
      TranscriptionStatus: 'completed',
      TranscriptionText: 'Please call back.',
    }
    expect((await POST(request(transcript))).status).toBe(500)
    expect(savedMessages[0].metadata?.email_sent).toBe(true)
    expect(savedMessages[0].metadata?.transcription_email_id).toBeNull()
    expect((await POST(request(transcript))).status).toBe(200)
    expect(mocks.send).toHaveBeenCalledTimes(3)
    expect(mocks.send.mock.calls[1]).toEqual(mocks.send.mock.calls[2])
    expect(savedMessages[0].metadata?.transcription_email_id).toBe(
      'transcript-email-1',
    )
  })

  it('keeps transcript retry content stable when saving acceptance fails and later callbacks change text', async () => {
    await POST(request())
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
    expect(mocks.send.mock.calls[1]).toEqual(mocks.send.mock.calls[2])
    expect(mocks.send.mock.calls[2][0].text).toContain('First transcript')
    expect(savedMessages[0].metadata?.transcription).toBe(
      'Later corrected transcript',
    )
    expect(savedMessages[0].metadata?.transcription_email_id).toBe(
      'transcript-email-1',
    )
  })

  it('uses the same transcript provider key and payload for overlapping callbacks', async () => {
    await POST(request())
    const transcript = { TranscriptionText: 'Please call back.' }
    await Promise.all([POST(request(transcript)), POST(request(transcript))])
    const transcriptCalls = mocks.send.mock.calls.slice(1)
    expect(transcriptCalls).toHaveLength(2)
    expect(transcriptCalls[0]).toEqual(transcriptCalls[1])
    expect(savedMessages[0].metadata?.transcription_email_id).toBe(
      'transcript-email-1',
    )
  })

  it('does not mark a transcript accepted without a provider email id', async () => {
    await POST(request())
    mocks.send.mockResolvedValueOnce({ data: {}, error: null })
    expect(
      (await POST(request({ TranscriptionText: 'Call me.' }))).status,
    ).toBe(500)
    expect(savedMessages[0].metadata?.transcription_email_id).toBeNull()
  })

  it('uses the same provider key and payload for overlapping completion callbacks', async () => {
    await Promise.all([POST(request()), POST(request())])
    expect(mocks.send).toHaveBeenCalledTimes(2)
    expect(mocks.send.mock.calls[0]).toEqual(mocks.send.mock.calls[1])
    expect(savedMessages).toHaveLength(1)
    expect(savedMessages[0].metadata?.email_sent).toBe(true)
  })

  it('returns a retryable failure without marking sent when the provider rejects email', async () => {
    mocks.send.mockResolvedValueOnce({
      data: null,
      error: { message: 'Temporary outage' },
    })
    expect((await POST(request())).status).toBe(500)
    expect(savedMessages[0].metadata?.email_sent).toBe(false)
    expect((await POST(request())).status).toBe(200)
    expect(mocks.send).toHaveBeenCalledTimes(2)
    expect(mocks.send.mock.calls[0]).toEqual(mocks.send.mock.calls[1])
    expect(savedMessages[0].metadata?.email_sent).toBe(true)
  })

  it('reuses the provider key if saving the success marker fails after acceptance', async () => {
    const merge = mocks.rpc.getMockImplementation()!
    let failMarker = true
    mocks.rpc.mockImplementation(async (name, args) => {
      if (args.p_email_sent && failMarker) {
        failMarker = false
        return {
          data: null,
          error: { message: 'Database temporarily unavailable' },
        }
      }
      return merge(name, args)
    })
    expect((await POST(request())).status).toBe(500)
    expect(savedMessages[0].metadata?.email_sent).toBe(false)
    expect((await POST(request())).status).toBe(200)
    expect(mocks.send.mock.calls[0]).toEqual(mocks.send.mock.calls[1])
    expect(savedMessages[0].metadata?.email_sent).toBe(true)
  })

  it('does not mark sent when the provider returns no delivery id', async () => {
    mocks.send.mockResolvedValue({ data: {}, error: null })
    expect((await POST(request())).status).toBe(500)
    expect(savedMessages[0].metadata?.email_sent).toBe(false)
  })

  it('reuses identical email content if a transcript arrives after a failed notification', async () => {
    mocks.send.mockResolvedValueOnce({
      data: null,
      error: { message: 'Try again' },
    })
    await POST(request())
    expect(
      (
        await POST(
          request({
            RecordingStatus: '',
            RecordingUrl: '',
            RecordingDuration: '',
            TranscriptionText: 'A later transcript',
            TranscriptionStatus: 'completed',
          }),
        )
      ).status,
    ).toBe(200)
    expect(mocks.send.mock.calls[0]).toEqual(mocks.send.mock.calls[1])
  })

  it('rejects forged callbacks before any database or provider work', async () => {
    expect((await POST(request({}, false))).status).toBe(403)
    expect(mocks.from).not.toHaveBeenCalled()
    expect(mocks.rpc).not.toHaveBeenCalled()
    expect(mocks.send).not.toHaveBeenCalled()
  })
})
