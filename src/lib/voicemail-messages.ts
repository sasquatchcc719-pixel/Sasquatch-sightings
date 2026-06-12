export type VoicemailConversationMessage = {
  role?: string
  content?: string
  timestamp?: string
  metadata?: {
    type?: string
    transcription?: string | null
    recording_url?: string | null
    recording_sid?: string | null
    duration?: string | null
  } | null
}

const EMPTY_TRANSCRIPT_VALUES = new Set([
  '(no transcription available)',
  'no transcription available',
  'no transcription',
  '(none)',
  'none',
])

export function hasMeaningfulVoicemailTranscription(
  transcription: string | null | undefined,
): boolean {
  const normalized = transcription?.trim().toLowerCase() ?? ''
  return normalized.length > 0 && !EMPTY_TRANSCRIPT_VALUES.has(normalized)
}

export function isUntranscribedVoicemailMessage(
  message: VoicemailConversationMessage,
): boolean {
  if (message?.role !== 'user') return false

  if (message?.metadata?.type === 'voicemail') {
    return !hasMeaningfulVoicemailTranscription(message.metadata.transcription)
  }

  const content = message?.content?.trim().toLowerCase() ?? ''
  return (
    content.startsWith('[voicemail') &&
    (content.includes('(no transcription available)') ||
      content.endsWith('no transcription'))
  )
}

export function getVisibleConversationMessages<
  T extends VoicemailConversationMessage,
>(messages: T[]): T[] {
  return messages.filter((message) => !isUntranscribedVoicemailMessage(message))
}

type MergeVoicemailTranscriptInput = {
  recordingSid: string
  recordingUrl: string | null
  recordingDuration: string | null
  transcription: string | null
  timestamp?: string
}

export function mergeVoicemailTranscriptMessage<
  T extends VoicemailConversationMessage,
>(
  messages: T[],
  input: MergeVoicemailTranscriptInput,
): { messages: VoicemailConversationMessage[]; changed: boolean } {
  if (
    !input.recordingSid ||
    !hasMeaningfulVoicemailTranscription(input.transcription)
  ) {
    return { messages, changed: false }
  }

  const transcription = String(input.transcription).trim()
  const content = `[VOICEMAIL - ${input.recordingDuration ?? '0'}s] ${transcription}`
  const metadata = {
    type: 'voicemail',
    recording_url: input.recordingUrl,
    recording_sid: input.recordingSid,
    duration: input.recordingDuration,
    transcription,
  }
  const nextMessages: VoicemailConversationMessage[] = [...messages]
  const existingIndex = nextMessages.findIndex(
    (message) =>
      message?.role === 'user' &&
      message?.metadata?.type === 'voicemail' &&
      message?.metadata?.recording_sid === input.recordingSid,
  )

  if (existingIndex >= 0) {
    const previous = nextMessages[existingIndex]
    nextMessages[existingIndex] = {
      ...previous,
      content,
      metadata: { ...previous.metadata, ...metadata },
    }
  } else {
    nextMessages.push({
      role: 'user',
      content,
      timestamp: input.timestamp ?? new Date().toISOString(),
      metadata,
    })
  }

  return { messages: nextMessages, changed: true }
}
