import { describe, it, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { resolveCallHistory, writeCallLog } from './call-history'

const parent = {
  sid: 'CAparent',
  status: 'completed' as const,
  duration: '120',
}
const connected = {
  sid: 'CAchild',
  status: 'completed' as const,
  duration: '7',
}
const recording = {
  status: 'completed' as const,
  source: 'RecordVerb' as const,
  duration: '11',
  uri: '/2010-04-01/Accounts/AC1/Recordings/RE1.json',
}

describe('call history evidence', () => {
  it('counts a long IVR call with no connection or recording as missed', () => {
    expect(resolveCallHistory(parent, [], [])).toMatchObject({
      outcome: 'no-answer',
      duration_seconds: null,
    })
  })
  it('counts a short completed child as answered using the child duration', () => {
    expect(resolveCallHistory(parent, [connected], [])).toMatchObject({
      outcome: 'answered',
      duration_seconds: 7,
    })
  })
  it('uses the answered secondary leg even if the primary did not answer', () => {
    expect(
      resolveCallHistory(
        parent,
        [
          { ...connected, status: 'no-answer', duration: '0' },
          { ...connected, duration: '300' },
        ],
        [],
      ),
    ).toMatchObject({ outcome: 'answered', duration_seconds: 300 })
  })
  it('classifies an actual voicemail and builds its playable URL', () => {
    expect(resolveCallHistory(parent, [], [recording])).toMatchObject({
      outcome: 'voicemail',
      duration_seconds: 11,
      recording_url:
        'https://api.twilio.com/2010-04-01/Accounts/AC1/Recordings/RE1.mp3',
    })
  })
  it('preserves recorded voicemail evidence when Twilio no longer has the media', () => {
    expect(
      resolveCallHistory(parent, [], [], {
        recording_url: 'https://api.twilio.com/saved.mp3',
        transcription: 'Call me back',
      })?.outcome,
    ).toBe('voicemail')
  })
  it('does not classify an empty recording or a recorded conversation as voicemail', () => {
    expect(
      resolveCallHistory(parent, [], [{ ...recording, duration: '0' }])
        ?.outcome,
    ).toBe('no-answer')
    expect(
      resolveCallHistory(
        parent,
        [connected],
        [{ ...recording, source: 'DialVerb' }],
      )?.outcome,
    ).toBe('answered')
  })
  it('waits for a real call or recording to finish', () => {
    expect(
      resolveCallHistory({ ...parent, status: 'in-progress' }, [], []),
    ).toBeNull()
    expect(
      resolveCallHistory(parent, [{ ...connected, status: 'ringing' }], []),
    ).toBeNull()
    expect(
      resolveCallHistory(parent, [], [{ ...recording, status: 'processing' }]),
    ).toBeNull()
  })
})

describe('call log callback persistence', () => {
  function database() {
    const query = {
      eq: vi.fn().mockReturnThis(),
      neq: vi.fn().mockReturnThis(),
      then: (resolve: (result: { error: null }) => unknown) =>
        Promise.resolve({ error: null }).then(resolve),
    }
    const table = {
      upsert: vi.fn().mockResolvedValue({ error: null }),
      update: vi.fn().mockReturnValue(query),
    }
    const db = { from: vi.fn().mockReturnValue(table) }
    return { db: db as unknown as SupabaseClient, table, query }
  }

  it('prevents late missed callbacks from overwriting answered, voicemail or blocked calls', async () => {
    const { db, table, query } = database()
    await writeCallLog(db, { call_sid: parent.sid, outcome: 'no-answer' })
    expect(table.upsert).toHaveBeenCalledWith(expect.anything(), {
      onConflict: 'call_sid',
      ignoreDuplicates: true,
    })
    expect(query.neq.mock.calls).toEqual([
      ['outcome', 'blacklisted'],
      ['outcome', 'voicemail'],
      ['outcome', 'answered'],
    ])
  })

  it('does not erase recordings or transcripts when a later callback omits them', async () => {
    const { db, table, query } = database()
    await writeCallLog(db, { call_sid: parent.sid, outcome: 'voicemail' })
    expect(table.update.mock.calls[0][0]).not.toHaveProperty('recording_url')
    expect(table.update.mock.calls[0][0]).not.toHaveProperty('transcription')
    expect(query.neq.mock.calls).toEqual([['outcome', 'blacklisted']])
  })

  it('propagates failed writes so the final callback can return an error', async () => {
    const { db, table } = database()
    table.upsert.mockResolvedValue({ error: new Error('Database unavailable') })
    await expect(
      writeCallLog(db, { call_sid: parent.sid, outcome: 'answered' }),
    ).rejects.toThrow('Database unavailable')
    expect(table.update).not.toHaveBeenCalled()
  })
})
