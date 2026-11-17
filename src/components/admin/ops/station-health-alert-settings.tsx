'use client'

import { useCallback, useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Card } from '@/components/ui/card'

type SettingResponse = {
  enabled: boolean
  source: 'saved' | 'default'
  error?: string
}

export function StationHealthAlertSettings() {
  const [authorized, setAuthorized] = useState<boolean | null>(null)
  const [enabled, setEnabled] = useState(false)
  const [source, setSource] = useState<'saved' | 'default'>('default')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [savedMessage, setSavedMessage] = useState<string | null>(null)

  const loadSetting = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch('/api/admin/station-health-settings', {
        cache: 'no-store',
      })
      if (response.status === 401) {
        setAuthorized(false)
        return
      }
      const result = (await response.json()) as SettingResponse
      if (!response.ok) throw new Error(result.error || 'Failed to load switch')
      setAuthorized(true)
      setEnabled(result.enabled)
      setSource(result.source)
    } catch (loadError) {
      setAuthorized(true)
      setError(
        loadError instanceof Error
          ? loadError.message
          : 'Failed to load switch',
      )
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadSetting()
  }, [loadSetting])

  async function setSwitch(nextEnabled: boolean) {
    if (
      nextEnabled &&
      !window.confirm(
        'Turn ON automatic station-health check-in texts to eligible location partners?',
      )
    ) {
      return
    }

    setSaving(true)
    setError(null)
    setSavedMessage(null)
    try {
      const response = await fetch('/api/admin/station-health-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: nextEnabled }),
      })
      const result = (await response.json()) as SettingResponse
      if (!response.ok) throw new Error(result.error || 'Failed to save switch')
      setEnabled(result.enabled)
      setSource('saved')
      setSavedMessage(
        result.enabled
          ? 'Saved ON. The daily station-health job may send eligible location-partner check-in texts.'
          : 'Saved OFF. Automatic station-health check-in texts cannot send.',
      )
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : 'Failed to save switch',
      )
    } finally {
      setSaving(false)
    }
  }

  if (authorized === false) return null

  return (
    <Card className="border-border/60 bg-card/80 p-6 shadow-sm backdrop-blur">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-3xl">
          <h3 className="text-lg font-semibold">
            Automatic Placard Check-in Texts
          </h3>
          <p className="text-muted-foreground mt-1 text-sm">
            Controls only the daily station-health SMS that checks in with a
            location partner after 14 days without NFC activity. OFF prevents
            partner reads, SMS attempts, and sent/cooldown records. Customer
            texts, booking notifications, and every other scheduled job are
            unaffected.
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-label="Automatic placard check-in texts"
          disabled={loading || saving || !!error}
          onClick={() => void setSwitch(!enabled)}
          className={`focus-visible:ring-ring flex min-h-11 min-w-32 items-center justify-center gap-3 rounded-xl border px-4 font-semibold transition focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-60 ${
            enabled
              ? 'border-emerald-400/60 bg-emerald-500/15 text-emerald-300'
              : 'border-red-400/60 bg-red-500/15 text-red-300'
          }`}
        >
          {loading || saving ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : null}
          <span>{enabled ? 'ON' : 'OFF'}</span>
        </button>
      </div>
      <p className="mt-4 text-sm font-medium" role="status">
        Saved current state: {loading ? 'loading…' : enabled ? 'ON' : 'OFF'}
        {!loading && source === 'default'
          ? ' (fail-closed default; no saved setting)'
          : ''}
      </p>
      {savedMessage ? (
        <p className="mt-2 text-sm text-emerald-400">{savedMessage}</p>
      ) : null}
      {error ? (
        <p className="mt-2 text-sm text-red-400" role="alert">
          {error}. The server remains fail-closed and will not send these texts.
        </p>
      ) : null}
    </Card>
  )
}
