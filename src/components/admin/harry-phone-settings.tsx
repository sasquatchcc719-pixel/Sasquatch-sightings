'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

type Settings = {
  previewReady: boolean
  publicReady: boolean
  publicEnabled: boolean
  previewPhone: string
  previewExpiresAt: string | null
}

const endpoint = '/api/admin/phone-settings/harry'

export function HarryPhoneSettings() {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [phone, setPhone] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    const controller = new AbortController()
    async function load() {
      try {
        const res = await fetch(endpoint, {
          signal: controller.signal,
          cache: 'no-store',
        })
        if (!res.ok) throw new Error()
        const data: Settings = await res.json()
        setSettings(data)
        setPhone(data.previewPhone)
      } catch {
        if (!controller.signal.aborted)
          setError('Could not load Harry’s phone settings.')
      }
    }
    void load()
    return () => controller.abort()
  }, [])

  useEffect(() => {
    if (!settings?.previewExpiresAt) return
    const timer = setTimeout(
      () =>
        setSettings(
          (current) =>
            current && {
              ...current,
              previewExpiresAt: null,
              previewPhone: '',
            },
        ),
      Math.max(0, Date.parse(settings.previewExpiresAt) - Date.now()),
    )
    return () => clearTimeout(timer)
  }, [settings?.previewExpiresAt])

  async function save(body: Record<string, unknown>) {
    setBusy(true)
    setError('')
    try {
      const res = await fetch(endpoint, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok)
        throw new Error(data.error || 'Could not save Harry’s phone settings.')
      setSettings(data)
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Could not save Harry’s phone settings.',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card className="space-y-4 p-6">
      <h2 className="text-xl font-semibold">Harry after hours</h2>
      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
      {settings ? (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="font-medium">
                Answer after-hours calls on the main number
              </p>
              {!settings.publicReady && (
                <p className="text-muted-foreground text-sm">
                  Public answering is locked during the private pilot.
                </p>
              )}
            </div>
            <Button
              type="button"
              role="switch"
              aria-label="Answer after-hours calls"
              aria-checked={settings.publicEnabled}
              variant="outline"
              disabled={busy || !settings.publicReady}
              onClick={() =>
                save({ action: 'set-public', enabled: !settings.publicEnabled })
              }
            >
              {settings.publicEnabled ? 'On' : 'Off'}
            </Button>
          </div>
          <div className="space-y-2 border-t pt-4">
            <Label htmlFor="harry-preview-phone">
              Private preview cell number
            </Label>
            <div className="flex flex-wrap gap-2">
              <Input
                id="harry-preview-phone"
                type="tel"
                autoComplete="tel"
                value={phone}
                disabled={
                  busy ||
                  !settings.previewReady ||
                  Boolean(settings.previewExpiresAt)
                }
                onChange={(event) => setPhone(event.target.value)}
                placeholder="(719) 555-0123"
                className="max-w-xs"
              />
              <Button
                type="button"
                variant="outline"
                disabled={
                  busy ||
                  !settings.previewReady ||
                  (!phone.trim() && !settings.previewExpiresAt)
                }
                onClick={() =>
                  save(
                    settings.previewExpiresAt
                      ? { action: 'stop-preview' }
                      : { action: 'start-preview', phone },
                  )
                }
              >
                {settings.previewExpiresAt
                  ? 'End preview'
                  : 'Start 30-minute preview'}
              </Button>
            </div>
            <p role="status" className="text-muted-foreground text-sm">
              {!settings.previewReady
                ? 'A private test call will be available once voice setup is complete.'
                : settings.previewExpiresAt
                  ? `Call the main number from ${settings.previewPhone} and press 1. Your preview ends at ${new Date(settings.previewExpiresAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.`
                  : 'Call the main number from this cell during the preview to try the after-hours directory. Bookings and transfers are simulated.'}
            </p>
          </div>
        </>
      ) : (
        !error && <p className="text-muted-foreground text-sm">Loading…</p>
      )}
    </Card>
  )
}
