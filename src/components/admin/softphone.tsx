'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { Device, Call } from '@twilio/voice-sdk'
import {
  Phone,
  PhoneOff,
  PhoneIncoming,
  Mic,
  MicOff,
  X,
  Volume2,
  Headphones,
  Bluetooth,
} from 'lucide-react'
import { Button } from '@/components/ui/button'

type SoftphoneState =
  | 'idle'
  | 'connecting'
  | 'ringing'
  | 'incoming'
  | 'in-call'
  | 'error'

type AudioOutputDevice = {
  deviceId: string
  label: string
}

type SoftphoneContextValue = {
  state: SoftphoneState
  call: (phoneNumber: string) => void
  hangUp: () => void
  acceptIncoming: () => void
  declineIncoming: () => void
  toggleMute: () => void
  cycleAudioOutput: () => void
  muted: boolean
  ready: boolean
  incomingFrom: string
  audioOutputs: AudioOutputDevice[]
  activeOutput: string
  initStatus: string
}

const SoftphoneContext = createContext<SoftphoneContextValue>({
  state: 'idle',
  call: () => {},
  hangUp: () => {},
  acceptIncoming: () => {},
  declineIncoming: () => {},
  toggleMute: () => {},
  cycleAudioOutput: () => {},
  muted: false,
  ready: false,
  incomingFrom: '',
  audioOutputs: [],
  activeOutput: '',
  initStatus: '',
})

export function useSoftphone() {
  return useContext(SoftphoneContext)
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

function formatDisplay(phone: string): string {
  const d = phone.replace(/\D/g, '')
  if (d.length === 11 && d.startsWith('1')) {
    return `+1 (${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7)}`
  }
  if (d.length === 10) {
    return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`
  }
  return phone
}

const MAX_INIT_RETRIES = 4
const RETRY_BASE_MS = 2000

export function SoftphoneProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SoftphoneState>('idle')
  const [muted, setMuted] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [callingNumber, setCallingNumber] = useState('')
  const [incomingFrom, setIncomingFrom] = useState('')
  const [errorMsg, setErrorMsg] = useState('')
  const [ready, setReady] = useState(false)
  const [audioOutputs, setAudioOutputs] = useState<AudioOutputDevice[]>([])
  const [initStatus, setInitStatus] = useState('')
  const [activeOutput, setActiveOutput] = useState('')

  const deviceRef = useRef<Device | null>(null)
  const activeCallRef = useRef<Call | null>(null)
  const incomingCallRef = useRef<Call | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const ringtoneRef = useRef<HTMLAudioElement | null>(null)
  const mountedRef = useRef(true)
  const stateRef = useRef<SoftphoneState>('idle')

  // Keep stateRef in sync so event handlers always see current state
  stateRef.current = state

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const startTimer = useCallback(() => {
    clearTimer()
    setElapsed(0)
    timerRef.current = setInterval(() => setElapsed((e) => e + 1), 1000)
  }, [clearTimer])

  const stopRingtone = useCallback(() => {
    if (ringtoneRef.current) {
      ringtoneRef.current.pause()
      ringtoneRef.current.currentTime = 0
    }
  }, [])

  const playRingtone = useCallback(() => {
    stopRingtone()
    try {
      const audio = new Audio('/ringtone.mp3')
      audio.loop = true
      audio.volume = 0.6
      ringtoneRef.current = audio
      audio.play().catch(() => {})
    } catch {
      // Audio playback may be blocked by browser policy
    }
  }, [stopRingtone])

  const fetchToken = useCallback(async () => {
    try {
      const res = await fetch('/api/twilio/voice-token', { method: 'POST' })
      if (!res.ok) return null
      return (await res.json()) as { token: string; identity: string }
    } catch {
      return null
    }
  }, [])

  // Stable init function stored in a ref so it never triggers effect re-runs
  const initRef = useRef<(() => Promise<void>) | null>(null)

  useEffect(() => {
    mountedRef.current = true

    const init = async (attempt = 0) => {
      if (!mountedRef.current) return

      setInitStatus(`Fetching token (attempt ${attempt + 1})...`)
      const data = await fetchToken()
      if (!data) {
        if (attempt < MAX_INIT_RETRIES && mountedRef.current) {
          const delay = RETRY_BASE_MS * Math.pow(2, attempt)
          setInitStatus(`Token fetch failed, retrying in ${delay / 1000}s...`)
          console.warn(
            `[Softphone] Token fetch failed, retrying in ${delay}ms (attempt ${attempt + 1}/${MAX_INIT_RETRIES})`,
          )
          setTimeout(() => init(attempt + 1), delay)
        } else {
          setInitStatus('Token fetch failed after all retries')
          console.error('[Softphone] Token fetch failed after all retries')
        }
        return
      }

      if (!mountedRef.current) return
      setInitStatus('Token OK, creating Device...')

      if (deviceRef.current) {
        deviceRef.current.destroy()
        deviceRef.current = null
      }

      const device = new Device(data.token, {
        logLevel: 1,
        codecPreferences: [Call.Codec.Opus, Call.Codec.PCMU],
        closeProtection: true,
      })

      device.on('error', (err) => {
        console.error('[Softphone] Device error:', err)
        // Use ref to read current state — never stale
        const current = stateRef.current
        if (
          current === 'in-call' ||
          current === 'connecting' ||
          current === 'ringing'
        ) {
          // Transient errors during active calls — log but don't kill state
          console.warn(
            '[Softphone] Transient error during active call, ignoring',
          )
          return
        }
        setState('error')
        setErrorMsg(err.message || 'Device error')
        stopRingtone()
      })

      device.on('tokenWillExpire', async () => {
        console.log('[Softphone] Token expiring, refreshing...')
        const refreshed = await fetchToken()
        if (refreshed) {
          device.updateToken(refreshed.token)
          console.log('[Softphone] Token refreshed')
        } else {
          console.error('[Softphone] Token refresh failed')
        }
      })

      device.on('unregistered', () => {
        console.warn(
          '[Softphone] Device unregistered, will re-register on reconnect',
        )
        if (mountedRef.current) setReady(false)
      })

      device.on('registered', () => {
        console.log('[Softphone] Device registered')
        if (mountedRef.current) setReady(true)
      })

      device.on('incoming', (incomingCall: Call) => {
        console.log(
          '[Softphone] Incoming call from:',
          incomingCall.parameters?.From,
        )

        if (activeCallRef.current) {
          incomingCall.reject()
          return
        }

        incomingCallRef.current = incomingCall
        const from = incomingCall.parameters?.From || 'Unknown'
        setIncomingFrom(from)
        setCallingNumber(from)
        setState('incoming')
        playRingtone()

        incomingCall.on('cancel', () => {
          console.log('[Softphone] Incoming call cancelled (caller hung up)')
          incomingCallRef.current = null
          setState('idle')
          setIncomingFrom('')
          stopRingtone()
        })

        incomingCall.on('disconnect', () => {
          console.log('[Softphone] Call disconnected')
          activeCallRef.current = null
          incomingCallRef.current = null
          setState('idle')
          setIncomingFrom('')
          clearTimer()
          stopRingtone()
        })

        incomingCall.on('error', (err) => {
          console.error('[Softphone] Incoming call error:', err)
          setState('error')
          setErrorMsg(err.message || 'Call error')
          activeCallRef.current = null
          incomingCallRef.current = null
          clearTimer()
          stopRingtone()
        })
      })

      try {
        setInitStatus('Registering with Twilio...')
        await device.register()
        deviceRef.current = device
        setInitStatus('Registered')
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err)
        console.error('[Softphone] Device registration failed:', err)
        device.destroy()
        if (attempt < MAX_INIT_RETRIES && mountedRef.current) {
          const delay = RETRY_BASE_MS * Math.pow(2, attempt)
          setInitStatus(
            `Registration failed: ${msg}. Retrying in ${delay / 1000}s...`,
          )
          console.warn(`[Softphone] Retrying registration in ${delay}ms`)
          setTimeout(() => init(attempt + 1), delay)
        } else {
          setInitStatus(`Registration failed: ${msg}`)
        }
      }
    }

    initRef.current = () => init(0)
    init(0)

    // Re-register when the browser comes back online
    const handleOnline = () => {
      console.log('[Softphone] Network restored, re-initializing device')
      const device = deviceRef.current
      if (device) {
        // Try to re-register the existing device first
        device.register().catch(() => {
          console.warn('[Softphone] Re-register failed, full re-init')
          init(0)
        })
      } else {
        init(0)
      }
    }

    window.addEventListener('online', handleOnline)

    // Re-register after the page wakes from sleep/background
    const handleVisibility = () => {
      if (document.visibilityState === 'visible' && deviceRef.current) {
        const device = deviceRef.current
        // If the device lost its WebSocket during sleep, re-register
        if (device.state !== 'registered') {
          console.log(
            '[Softphone] Page visible, device not registered — re-registering',
          )
          device.register().catch(() => {
            console.warn(
              '[Softphone] Visibility re-register failed, full re-init',
            )
            init(0)
          })
        }
      }
    }

    document.addEventListener('visibilitychange', handleVisibility)

    return () => {
      mountedRef.current = false
      window.removeEventListener('online', handleOnline)
      document.removeEventListener('visibilitychange', handleVisibility)
      if (deviceRef.current) {
        deviceRef.current.destroy()
        deviceRef.current = null
      }
      clearTimer()
      stopRingtone()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const acceptIncoming = useCallback(() => {
    const incoming = incomingCallRef.current
    if (!incoming) return

    stopRingtone()
    incoming.accept()
    activeCallRef.current = incoming
    incomingCallRef.current = null
    setState('in-call')
    setMuted(false)
    startTimer()
  }, [startTimer, stopRingtone])

  const declineIncoming = useCallback(() => {
    const incoming = incomingCallRef.current
    if (!incoming) return

    stopRingtone()
    incoming.reject()
    incomingCallRef.current = null
    setState('idle')
    setIncomingFrom('')
  }, [stopRingtone])

  const makeCall = useCallback(
    (phoneNumber: string) => {
      if (!deviceRef.current || stateRef.current !== 'idle') return

      setCallingNumber(phoneNumber)
      setState('connecting')
      setMuted(false)
      setErrorMsg('')

      deviceRef.current
        .connect({ params: { To: phoneNumber } })
        .then((conn) => {
          activeCallRef.current = conn

          conn.on('accept', () => {
            setState('in-call')
            startTimer()
          })

          conn.on('ringing', () => {
            setState('ringing')
          })

          conn.on('disconnect', () => {
            setState('idle')
            activeCallRef.current = null
            clearTimer()
          })

          conn.on('cancel', () => {
            setState('idle')
            activeCallRef.current = null
            clearTimer()
          })

          conn.on('error', (err) => {
            console.error('[Softphone] Call error:', err)
            setState('error')
            setErrorMsg(err.message || 'Call failed')
            activeCallRef.current = null
            clearTimer()
          })
        })
        .catch((err) => {
          console.error('[Softphone] Connect error:', err)
          setState('error')
          setErrorMsg(err.message || 'Failed to connect')
        })
    },
    [startTimer, clearTimer],
  )

  const hangUp = useCallback(() => {
    if (activeCallRef.current) {
      activeCallRef.current.disconnect()
      activeCallRef.current = null
    }
    setState('idle')
    clearTimer()
    stopRingtone()
  }, [clearTimer, stopRingtone])

  const toggleMute = useCallback(() => {
    if (activeCallRef.current) {
      const next = !muted
      activeCallRef.current.mute(next)
      setMuted(next)
    }
  }, [muted])

  const dismiss = useCallback(() => {
    setState('idle')
    setErrorMsg('')
    stopRingtone()
  }, [stopRingtone])

  // Enumerate audio output devices and listen for changes
  const refreshOutputDevices = useCallback(async () => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices()
      const outputs = devices
        .filter((d) => d.kind === 'audiooutput')
        .map((d) => ({
          deviceId: d.deviceId,
          label:
            d.label || (d.deviceId === 'default' ? 'Speaker' : 'Audio Output'),
        }))
      setAudioOutputs(outputs)
      if (outputs.length > 0 && !activeOutput) {
        setActiveOutput(outputs[0].deviceId)
      }
    } catch {
      // enumerateDevices not supported
    }
  }, [activeOutput])

  useEffect(() => {
    const id = requestAnimationFrame(() => refreshOutputDevices())
    const handler = () => refreshOutputDevices()
    navigator.mediaDevices?.addEventListener?.('devicechange', handler)
    return () => {
      cancelAnimationFrame(id)
      navigator.mediaDevices?.removeEventListener?.('devicechange', handler)
    }
  }, [refreshOutputDevices])

  const cycleAudioOutput = useCallback(async () => {
    if (audioOutputs.length < 2) return

    const currentIdx = audioOutputs.findIndex(
      (d) => d.deviceId === activeOutput,
    )
    const nextIdx = (currentIdx + 1) % audioOutputs.length
    const nextDevice = audioOutputs[nextIdx]

    try {
      const device = deviceRef.current
      if (device?.audio?.speakerDevices) {
        await device.audio.speakerDevices.set(nextDevice.deviceId)
      }
      setActiveOutput(nextDevice.deviceId)
      console.log('[Softphone] Audio output switched to:', nextDevice.label)
    } catch (err) {
      console.error('[Softphone] Failed to switch audio output:', err)
    }
  }, [audioOutputs, activeOutput])

  return (
    <SoftphoneContext.Provider
      value={{
        state,
        call: makeCall,
        hangUp,
        acceptIncoming,
        declineIncoming,
        toggleMute,
        cycleAudioOutput,
        muted,
        ready,
        incomingFrom,
        audioOutputs,
        activeOutput,
        initStatus,
      }}
    >
      {children}

      {/* Floating call bar */}
      {state !== 'idle' && (
        <div className="fixed bottom-6 left-1/2 z-[9999] -translate-x-1/2">
          <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-slate-900/95 px-5 py-3 shadow-2xl backdrop-blur-md">
            {/* Status indicator */}
            <div
              className={`h-3 w-3 rounded-full ${
                state === 'in-call'
                  ? 'animate-pulse bg-green-500'
                  : state === 'incoming'
                    ? 'animate-ping bg-blue-500'
                    : state === 'error'
                      ? 'bg-red-500'
                      : 'animate-pulse bg-yellow-500'
              }`}
            />

            {/* Info */}
            <div className="min-w-0">
              <p className="text-sm font-medium text-white">
                {state === 'incoming'
                  ? formatDisplay(incomingFrom)
                  : formatDisplay(callingNumber)}
              </p>
              <p className="text-xs text-white/50">
                {state === 'incoming' && 'Incoming call...'}
                {state === 'connecting' && 'Connecting...'}
                {state === 'ringing' && 'Ringing...'}
                {state === 'in-call' && formatDuration(elapsed)}
                {state === 'error' && (errorMsg || 'Error')}
              </p>
            </div>

            {/* Incoming call controls */}
            {state === 'incoming' && (
              <>
                <Button
                  size="sm"
                  className="h-9 w-9 rounded-full bg-green-600 p-0 hover:bg-green-500"
                  onClick={acceptIncoming}
                  title="Answer"
                >
                  <PhoneIncoming className="h-4 w-4 text-white" />
                </Button>
                <Button
                  size="sm"
                  className="h-9 w-9 rounded-full bg-red-600 p-0 hover:bg-red-700"
                  onClick={declineIncoming}
                  title="Decline"
                >
                  <PhoneOff className="h-4 w-4 text-white" />
                </Button>
              </>
            )}

            {/* Active call controls */}
            {(state === 'in-call' ||
              state === 'ringing' ||
              state === 'connecting') && (
              <>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-9 w-9 rounded-full p-0 text-white hover:bg-white/10"
                  onClick={toggleMute}
                  title={muted ? 'Unmute' : 'Mute'}
                >
                  {muted ? (
                    <MicOff className="h-4 w-4 text-red-400" />
                  ) : (
                    <Mic className="h-4 w-4" />
                  )}
                </Button>
                {audioOutputs.length > 1 && (
                  <AudioOutputButton
                    activeOutput={activeOutput}
                    outputs={audioOutputs}
                    onCycle={cycleAudioOutput}
                  />
                )}
                <Button
                  size="sm"
                  className="h-9 w-9 rounded-full bg-red-600 p-0 hover:bg-red-700"
                  onClick={hangUp}
                  title="Hang up"
                >
                  <PhoneOff className="h-4 w-4 text-white" />
                </Button>
              </>
            )}

            {state === 'error' && (
              <Button
                size="sm"
                variant="ghost"
                className="h-9 w-9 rounded-full p-0 text-white hover:bg-white/10"
                onClick={dismiss}
                title="Dismiss"
              >
                <X className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
      )}
    </SoftphoneContext.Provider>
  )
}

function AudioOutputButton({
  activeOutput,
  outputs,
  onCycle,
}: {
  activeOutput: string
  outputs: AudioOutputDevice[]
  onCycle: () => void
}) {
  const current = outputs.find((d) => d.deviceId === activeOutput)
  const label = current?.label?.toLowerCase() || ''
  const isBluetooth =
    label.includes('bluetooth') ||
    label.includes('airpod') ||
    label.includes('beats') ||
    label.includes('bose') ||
    label.includes('jbl') ||
    label.includes('sony')
  const isHeadphones =
    isBluetooth || label.includes('headphone') || label.includes('earbud')

  const Icon = isBluetooth ? Bluetooth : isHeadphones ? Headphones : Volume2

  return (
    <Button
      size="sm"
      variant="ghost"
      className={`h-9 w-9 rounded-full p-0 hover:bg-white/10 ${
        isHeadphones ? 'text-blue-400' : 'text-white'
      }`}
      onClick={onCycle}
      title={`Audio: ${current?.label || 'Speaker'} -- tap to switch`}
    >
      <Icon className="h-4 w-4" />
    </Button>
  )
}

/** Standalone call button for use anywhere in the admin UI */
export function CallButton({
  phoneNumber,
  className,
}: {
  phoneNumber: string
  className?: string
}) {
  const { call, state, ready } = useSoftphone()

  return (
    <Button
      size="sm"
      variant="ghost"
      className={`h-8 w-8 rounded-full p-0 text-green-400 hover:bg-green-500/20 hover:text-green-300 ${className || ''}`}
      onClick={(e) => {
        e.preventDefault()
        e.stopPropagation()
        call(phoneNumber)
      }}
      disabled={!ready || state !== 'idle'}
      title={ready ? `Call ${phoneNumber}` : 'Voice not configured'}
    >
      <Phone className="h-4 w-4" />
    </Button>
  )
}
