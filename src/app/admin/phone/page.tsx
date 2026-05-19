'use client'

import { useCallback, useEffect, useState } from 'react'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { useSoftphone } from '@/components/admin/softphone'
import {
  Phone,
  PhoneOff,
  PhoneIncoming,
  Mic,
  MicOff,
  Delete,
  AlertCircle,
  Volume2,
  Headphones,
  Bluetooth,
} from 'lucide-react'

const DIAL_PAD = [
  { digit: '1', letters: '' },
  { digit: '2', letters: 'ABC' },
  { digit: '3', letters: 'DEF' },
  { digit: '4', letters: 'GHI' },
  { digit: '5', letters: 'JKL' },
  { digit: '6', letters: 'MNO' },
  { digit: '7', letters: 'PQRS' },
  { digit: '8', letters: 'TUV' },
  { digit: '9', letters: 'WXYZ' },
  { digit: '*', letters: '' },
  { digit: '0', letters: '+' },
  { digit: '#', letters: '' },
]

function formatPhoneDisplay(raw: string): string {
  const d = raw.replace(/\D/g, '')
  if (d.length <= 3) return d
  if (d.length <= 6) return `(${d.slice(0, 3)}) ${d.slice(3)}`
  if (d.length <= 10) return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`
  return `+${d.slice(0, 1)} (${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7, 11)}`
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

type OutputDev = { deviceId: string; label: string }

function AudioOutputBtn({
  activeOutput,
  outputs,
  onCycle,
}: {
  activeOutput: string
  outputs: OutputDev[]
  onCycle: () => void
}) {
  const current = outputs.find((d) => d.deviceId === activeOutput)
  const label = current?.label?.toLowerCase() || ''
  const isBt =
    label.includes('bluetooth') ||
    label.includes('airpod') ||
    label.includes('beats') ||
    label.includes('bose') ||
    label.includes('jbl') ||
    label.includes('sony')
  const isHp = isBt || label.includes('headphone') || label.includes('earbud')
  const Icon = isBt ? Bluetooth : isHp ? Headphones : Volume2

  return (
    <button
      onClick={onCycle}
      className={`flex h-14 w-14 flex-col items-center justify-center rounded-full transition-colors ${
        isHp
          ? 'bg-blue-500/20 text-blue-400'
          : 'bg-white/10 text-white hover:bg-white/20'
      }`}
      title={`Audio: ${current?.label || 'Speaker'} — tap to switch`}
    >
      <Icon className="h-5 w-5" />
      <span className="mt-0.5 max-w-[48px] truncate text-[8px]">
        {current?.label?.split(' ')[0] || 'Speaker'}
      </span>
    </button>
  )
}

export default function PhonePage() {
  const {
    call,
    hangUp,
    acceptIncoming,
    declineIncoming,
    toggleMute,
    cycleAudioOutput,
    muted,
    state,
    ready,
    incomingFrom,
    audioOutputs,
    activeOutput,
    initStatus,
  } = useSoftphone()
  const [number, setNumber] = useState('')
  const [elapsed, setElapsed] = useState(0)

  const inCall =
    state === 'in-call' || state === 'ringing' || state === 'connecting'
  const isIncoming = state === 'incoming'
  const busy = inCall || isIncoming

  useEffect(() => {
    if (state !== 'in-call') {
      const id = requestAnimationFrame(() => setElapsed(0))
      return () => cancelAnimationFrame(id)
    }
    const t = setInterval(() => setElapsed((e) => e + 1), 1000)
    return () => clearInterval(t)
  }, [state])

  const pressDigit = useCallback(
    (digit: string) => {
      if (!busy) setNumber((n) => n + digit)
    },
    [busy],
  )

  const handleBackspace = useCallback(() => {
    setNumber((n) => n.slice(0, -1))
  }, [])

  const handleCall = useCallback(() => {
    const digits = number.replace(/\D/g, '')
    if (digits.length < 10) return
    const formatted = digits.length === 10 ? `+1${digits}` : `+${digits}`
    call(formatted)
  }, [number, call])

  const statusLabel =
    state === 'incoming'
      ? 'Incoming call...'
      : state === 'connecting'
        ? 'Connecting...'
        : state === 'ringing'
          ? 'Ringing...'
          : state === 'in-call'
            ? formatDuration(elapsed)
            : state === 'error'
              ? 'Call failed'
              : null

  const displayNumber = isIncoming
    ? formatPhoneDisplay(incomingFrom)
    : inCall
      ? formatPhoneDisplay(number)
      : number

  return (
    <div className="mx-auto max-w-md space-y-6">
      <h1 className="text-2xl font-bold">Phone</h1>

      {!ready && (
        <Card className="border-yellow-500/30 bg-yellow-500/10 p-4">
          <div className="flex items-center gap-2 text-yellow-400">
            <AlertCircle className="h-4 w-4 flex-shrink-0" />
            <p className="text-sm">
              Voice calling is initializing. If this persists, check your Twilio
              configuration in Settings.
            </p>
            {initStatus && (
              <p className="mt-1 text-xs text-yellow-400/70">{initStatus}</p>
            )}
          </div>
        </Card>
      )}

      <Card className="overflow-hidden p-6">
        {/* Number display */}
        <div className="mb-6 text-center">
          <Input
            value={displayNumber}
            onChange={(e) => {
              if (!busy) setNumber(e.target.value.replace(/[^0-9+*#]/g, ''))
            }}
            placeholder="Enter phone number"
            className="border-none bg-transparent text-center text-2xl font-light tracking-wider focus-visible:ring-0"
            readOnly={busy}
          />
          {statusLabel && (
            <p
              className={`mt-1 text-sm ${
                state === 'error'
                  ? 'text-red-400'
                  : state === 'in-call'
                    ? 'text-green-400'
                    : state === 'incoming'
                      ? 'animate-pulse text-blue-400'
                      : 'text-muted-foreground'
              }`}
            >
              {statusLabel}
            </p>
          )}
        </div>

        {/* Dial pad */}
        <div className="mb-6 grid grid-cols-3 gap-3">
          {DIAL_PAD.map(({ digit, letters }) => (
            <button
              key={digit}
              onClick={() => pressDigit(digit)}
              disabled={busy}
              className="flex h-16 flex-col items-center justify-center rounded-xl bg-white/5 transition-colors hover:bg-white/10 active:bg-white/20 disabled:pointer-events-none disabled:opacity-40"
            >
              <span className="text-2xl font-light">{digit}</span>
              {letters && (
                <span className="text-muted-foreground text-[10px] tracking-[0.2em]">
                  {letters}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Action buttons */}
        <div className="flex items-center justify-center gap-4">
          {isIncoming ? (
            <>
              <button
                onClick={declineIncoming}
                className="flex h-16 w-16 items-center justify-center rounded-full bg-red-600 text-white shadow-lg shadow-red-600/30 transition-all hover:bg-red-500"
              >
                <PhoneOff className="h-6 w-6" />
              </button>
              <button
                onClick={acceptIncoming}
                className="flex h-16 w-16 items-center justify-center rounded-full bg-green-600 text-white shadow-lg shadow-green-600/30 transition-all hover:bg-green-500 hover:shadow-green-500/40"
              >
                <PhoneIncoming className="h-6 w-6" />
              </button>
            </>
          ) : !inCall ? (
            <>
              <button
                onClick={handleBackspace}
                disabled={!number}
                className="text-muted-foreground flex h-14 w-14 items-center justify-center rounded-full transition-colors hover:bg-white/10 disabled:opacity-30"
              >
                <Delete className="h-5 w-5" />
              </button>
              <button
                onClick={handleCall}
                disabled={!ready || number.replace(/\D/g, '').length < 10}
                className="flex h-16 w-16 items-center justify-center rounded-full bg-green-600 text-white shadow-lg shadow-green-600/30 transition-all hover:bg-green-500 hover:shadow-green-500/40 disabled:opacity-40 disabled:shadow-none"
              >
                <Phone className="h-6 w-6" />
              </button>
              <div className="h-14 w-14" />
            </>
          ) : (
            <>
              <button
                onClick={toggleMute}
                className={`flex h-14 w-14 items-center justify-center rounded-full transition-colors ${
                  muted
                    ? 'bg-red-500/20 text-red-400'
                    : 'bg-white/10 text-white hover:bg-white/20'
                }`}
              >
                {muted ? (
                  <MicOff className="h-5 w-5" />
                ) : (
                  <Mic className="h-5 w-5" />
                )}
              </button>
              <button
                onClick={hangUp}
                className="flex h-16 w-16 items-center justify-center rounded-full bg-red-600 text-white shadow-lg shadow-red-600/30 transition-all hover:bg-red-500"
              >
                <PhoneOff className="h-6 w-6" />
              </button>
              {audioOutputs.length > 1 ? (
                <AudioOutputBtn
                  activeOutput={activeOutput}
                  outputs={audioOutputs}
                  onCycle={cycleAudioOutput}
                />
              ) : (
                <div className="h-14 w-14" />
              )}
            </>
          )}
        </div>
      </Card>

      <p className="text-muted-foreground text-center text-xs">
        Calls are placed and received on your Sasquatch business line via Twilio
      </p>
    </div>
  )
}
