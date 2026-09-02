'use client'

import { useState } from 'react'

const ACCENT = '#2d6a4f'

type Props = {
  token: string
  initialStatus: string
  locked: boolean
  textNumber: string
}

/**
 * Accept / decline buttons. These POST — the emailed link is only ever a GET on
 * this page, so a mail scanner walking links cannot accept a bid on the
 * customer's behalf.
 */
export function EstimateDecision({
  token,
  initialStatus,
  locked,
  textNumber,
}: Props) {
  const [status, setStatus] = useState(initialStatus)
  const [pending, setPending] = useState<'accepted' | 'declined' | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function decide(decision: 'accepted' | 'declined') {
    setPending(decision)
    setError(null)
    try {
      const res = await fetch('/api/public/estimates/decision', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, decision }),
      })
      const payload = await res.json().catch(() => null)
      if (!res.ok) {
        throw new Error(payload?.error || 'Something went wrong.')
      }
      setStatus(decision)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.')
    } finally {
      setPending(null)
    }
  }

  if (locked) {
    return (
      <div style={box('#f0f7f3', ACCENT)}>
        <strong>This job is already on our schedule.</strong>
        <div style={{ marginTop: 6, fontSize: 14 }}>
          Need to change anything? Text us at {textNumber}.
        </div>
      </div>
    )
  }

  if (status === 'accepted') {
    return (
      <div style={box('#f0f7f3', ACCENT)}>
        <strong>Thank you — your estimate is accepted.</strong>
        <div style={{ marginTop: 6, fontSize: 14 }}>
          We&apos;ll reach out shortly to get you on the calendar. If you need a
          specific day, text us at {textNumber}.
        </div>
      </div>
    )
  }

  if (status === 'declined') {
    return (
      <div style={box('#faf6f6', '#9b6b6b')}>
        <strong>Thanks for letting us know.</strong>
        <div style={{ marginTop: 6, fontSize: 14 }}>
          If anything changes, or you&apos;d like us to take another look at the
          pricing, text us at {textNumber}.
        </div>
      </div>
    )
  }

  return (
    <div>
      <p style={{ margin: '0 0 12px 0', lineHeight: 1.6 }}>
        Ready to move forward? Accept below and we&apos;ll get you on the
        calendar.
      </p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
        <button
          onClick={() => decide('accepted')}
          disabled={pending !== null}
          style={{
            flex: '1 1 200px',
            minHeight: 48,
            padding: '14px 20px',
            background: ACCENT,
            color: '#fff',
            border: 'none',
            borderRadius: 6,
            fontSize: 16,
            fontWeight: 700,
            cursor: pending ? 'default' : 'pointer',
            opacity: pending === 'declined' ? 0.5 : 1,
          }}
        >
          {pending === 'accepted' ? 'Accepting…' : 'Accept this estimate'}
        </button>
        <button
          onClick={() => decide('declined')}
          disabled={pending !== null}
          style={{
            flex: '0 1 auto',
            minHeight: 48,
            padding: '14px 20px',
            background: '#fff',
            color: '#666',
            border: '1px solid #ccc',
            borderRadius: 6,
            fontSize: 15,
            cursor: pending ? 'default' : 'pointer',
            opacity: pending === 'accepted' ? 0.5 : 1,
          }}
        >
          {pending === 'declined' ? 'Sending…' : 'No thanks'}
        </button>
      </div>
      {error ? (
        <p style={{ color: '#b23b3b', fontSize: 14, marginTop: 12, marginBottom: 0 }}>
          {error}
        </p>
      ) : null}
    </div>
  )
}

function box(background: string, border: string): React.CSSProperties {
  return {
    background,
    border: `1px solid ${border}`,
    borderRadius: 6,
    padding: 16,
    lineHeight: 1.5,
  }
}
