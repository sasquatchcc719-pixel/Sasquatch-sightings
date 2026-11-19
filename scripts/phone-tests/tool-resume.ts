// Controls a single call's sideband. The provider runs hosted MCP; seeing a
// successful HTTP request is too early to ask the model to use its result.
type Item = {
  id?: string
  type?: string
  name?: string
  output?: string | null
  error?: unknown
}
type Event = {
  type: string
  item?: Item
  response?: { id?: string; status?: string }
  response_id?: string
  item_id?: string
}

export function previewToolResume(
  readTools: ReadonlySet<string>,
  resume: () => void,
) {
  const pending = new Set<string>()
  let ready = false
  let active: string | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  function reset() {
    pending.clear()
    ready = false
    clearTimeout(timer)
  }
  function schedule() {
    if (!ready || pending.size || active) return
    clearTimeout(timer)
    timer = setTimeout(() => {
      if (ready && !pending.size && !active) {
        reset()
        resume()
      }
    }, 150)
  }
  return {
    dispose: reset,
    event(event: Event) {
      const item = event.item
      switch (event.type) {
        case 'input_audio_buffer.speech_started':
        case 'input_audio_buffer.timeout_triggered':
          active = undefined
          reset()
          break
        case 'response.created':
          reset()
          active = event.response?.id
          break
        case 'response.output_item.added':
          if (
            active &&
            event.response_id === active &&
            item?.type === 'mcp_call' &&
            item.id &&
            readTools.has(item.name ?? '')
          )
            pending.add(item.id)
          break
        case 'response.done':
          if (event.response?.id !== active) break
          active = undefined
          if (event.response?.status !== 'completed') reset()
          else schedule()
          break
        case 'conversation.item.added':
        case 'conversation.item.done':
          if (
            item?.type === 'mcp_call' &&
            item.id &&
            (item.output != null || item.error) &&
            pending.delete(item.id)
          ) {
            ready = true
            schedule()
          }
          break
      }
    },
  }
}
