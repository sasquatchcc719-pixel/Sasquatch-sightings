// Only the opening is app-triggered. Ordinary turns, buffered audio and
// interruptions belong to Realtime SIP. If speech wins the race, let VAD reply.
export function openingGuard(send: () => void, finish: () => void) {
  let timer: ReturnType<typeof setTimeout> | undefined
  let finished = false
  function dispose() {
    finished = true
    clearTimeout(timer)
  }
  return {
    event(type: string) {
      if (finished) return
      if (
        type === 'connected' ||
        type === 'session.created' ||
        type === 'session.updated'
      ) {
        if (!timer)
          timer = setTimeout(() => {
            if (!finished) {
              finished = true
              send()
            }
          }, 350)
      } else if (
        type === 'input_audio_buffer.speech_started' ||
        type === 'input_audio_buffer.committed' ||
        type === 'response.created'
      ) {
        dispose()
        finish()
      }
    },
    dispose,
  }
}
