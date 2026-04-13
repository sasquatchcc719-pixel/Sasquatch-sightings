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
import { Phone, PhoneOff, Mic, MicOff, X } from 'lucide-react'
import { Button } from '@/components/ui/button'

type SoftphoneState = 'idle' | 'connecting' | 'ringing' | 'in-call' | 'error'

type SoftphoneContextValue = {
  state: SoftphoneState
  call: (phoneNumber: string) => void
  hangUp: () => void
  ready: boolean
}

const SoftphoneContext = createContext<SoftphoneContextValue>({
  state: 'idle',
  call: () => {},
  hangUp: () => {},
  ready: false,
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

export function SoftphoneProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SoftphoneState>('idle')
  const [muted, setMuted] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [callingNumber, setCallingNumber] = useState('')
  const [errorMsg, setErrorMsg] = useState('')
  const [ready, setReady] = useState(false)

  const deviceRef = useRef<Device | null>(null)
  const activeCallRef = useRef<Call | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const tokenExpiryRef = useRef<ReturnType<typeof setTimeout> | null>(null)

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

  const fetchToken = useCallback(async () => {
    try {
      const res = await fetch('/api/twilio/voice-token', { method: 'POST' })
      if (!res.ok) return null
      return (await res.json()) as { token: string; identity: string }
    } catch {
      return null
    }
  }, [])

  const initDeviceRef = useRef<(() => Promise<void>) | undefined>(undefined)

  useEffect(() => {
    const init = async () => {
      const data = await fetchToken()
      if (!data) return

      if (deviceRef.current) {
        deviceRef.current.destroy()
      }

      const device = new Device(data.token, {
        logLevel: 1,
        codecPreferences: [Call.Codec.Opus, Call.Codec.PCMU],
      })

      device.on('error', (err) => {
        console.error('[Softphone] Device error:', err)
        setState('error')
        setErrorMsg(err.message || 'Device error')
      })

      device.on('tokenWillExpire', async () => {
        const refreshed = await fetchToken()
        if (refreshed) device.updateToken(refreshed.token)
      })

      await device.register()
      deviceRef.current = device
      setReady(true)

      if (tokenExpiryRef.current) clearTimeout(tokenExpiryRef.current)
      tokenExpiryRef.current = setTimeout(
        () => initDeviceRef.current?.(),
        50 * 60 * 1000,
      )
    }

    initDeviceRef.current = init
    init()

    return () => {
      if (deviceRef.current) deviceRef.current.destroy()
      if (tokenExpiryRef.current) clearTimeout(tokenExpiryRef.current)
      clearTimer()
    }
  }, [fetchToken, clearTimer])

  const makeCall = useCallback(
    (phoneNumber: string) => {
      if (!deviceRef.current || state !== 'idle') return

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
    [state, startTimer, clearTimer],
  )

  const hangUp = useCallback(() => {
    if (activeCallRef.current) {
      activeCallRef.current.disconnect()
      activeCallRef.current = null
    }
    setState('idle')
    clearTimer()
  }, [clearTimer])

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
  }, [])

  return (
    <SoftphoneContext.Provider value={{ state, call: makeCall, hangUp, ready }}>
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
                  : state === 'error'
                    ? 'bg-red-500'
                    : 'animate-pulse bg-yellow-500'
              }`}
            />

            {/* Info */}
            <div className="min-w-0">
              <p className="text-sm font-medium text-white">
                {formatDisplay(callingNumber)}
              </p>
              <p className="text-xs text-white/50">
                {state === 'connecting' && 'Connecting...'}
                {state === 'ringing' && 'Ringing...'}
                {state === 'in-call' && formatDuration(elapsed)}
                {state === 'error' && (errorMsg || 'Error')}
              </p>
            </div>

            {/* Controls */}
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
