import { describe, expect, it } from 'vitest'
import {
  getVisibleConversationMessages,
  mergeVoicemailTranscriptMessage,
} from './voicemail-messages'

describe('voicemail conversation messages', () => {
  it('hides legacy voicemail placeholders without hiding real transcripts', () => {
    const messages = [
      {
        role: 'user',
        content: '[VOICEMAIL - 5s] (No transcription available)',
        timestamp: '2026-06-09T17:41:00.000Z',
      },
      {
        role: 'user',
        content: '[VOICEMAIL - 33s] Please call me back',
        timestamp: '2026-06-09T17:42:00.000Z',
        metadata: {
          type: 'voicemail',
          transcription: 'Please call me back',
        },
      },
    ]

    expect(getVisibleConversationMessages(messages)).toEqual([messages[1]])
  })

  it('does not add a conversation message until a transcript exists', () => {
    const result = mergeVoicemailTranscriptMessage([], {
      recordingSid: 'RE123',
      recordingUrl: 'https://example.com/recording.mp3',
      recordingDuration: '5',
      transcription: null,
    })

    expect(result).toEqual({ messages: [], changed: false })
  })

  it('keeps one message per recording and replaces its transcript', () => {
    const first = mergeVoicemailTranscriptMessage([], {
      recordingSid: 'RE123',
      recordingUrl: 'https://example.com/recording.mp3',
      recordingDuration: '12',
      transcription: 'Please call me back',
      timestamp: '2026-06-12T12:00:00.000Z',
    })
    const updated = mergeVoicemailTranscriptMessage(first.messages, {
      recordingSid: 'RE123',
      recordingUrl: 'https://example.com/recording.mp3',
      recordingDuration: '12',
      transcription: 'Please call me back today',
    })

    expect(updated.messages).toHaveLength(1)
    expect(updated.messages[0]).toMatchObject({
      content: '[VOICEMAIL - 12s] Please call me back today',
      timestamp: '2026-06-12T12:00:00.000Z',
      metadata: {
        recording_sid: 'RE123',
        transcription: 'Please call me back today',
      },
    })
  })
})
