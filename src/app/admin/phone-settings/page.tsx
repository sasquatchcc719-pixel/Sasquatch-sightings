'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Checkbox } from '@/components/ui/checkbox'
import { Card } from '@/components/ui/card'

interface PhoneSettings {
  id: string
  voicemail_message: string
  voicemail_voice: string
  business_hours_start: number
  business_hours_end: number
  business_days: string[]
  sip_endpoints: string[]
  sip_domain: string
  dial_timeout: number
  updated_at: string
}

const VOICE_OPTIONS = [
  { value: 'Polly.Joanna-Neural', label: 'Joanna (Female, Natural)' },
  { value: 'Polly.Matthew-Neural', label: 'Matthew (Male, Natural)' },
  { value: 'Polly.Kendra-Neural', label: 'Kendra (Female, Professional)' },
  { value: 'Polly.Joey-Neural', label: 'Joey (Male, Friendly)' },
  { value: 'alice', label: 'Alice (Female, Standard)' },
  { value: 'man', label: 'Man (Male, Standard)' },
  { value: 'woman', label: 'Woman (Female, Standard)' },
]

const WEEKDAYS = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
]

export default function PhoneSettingsPage() {
  const [settings, setSettings] = useState<PhoneSettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  useEffect(() => {
    fetchSettings()
  }, [])

  async function fetchSettings() {
    try {
      const res = await fetch('/api/admin/phone-settings')
      if (!res.ok) throw new Error('Failed to fetch settings')
      const data = await res.json()
      setSettings(data)
    } catch (err) {
      setError('Failed to load phone settings')
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  async function saveSettings() {
    if (!settings) return
    setSaving(true)
    setError(null)
    setSuccess(false)

    try {
      const res = await fetch('/api/admin/phone-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      })

      if (!res.ok) throw new Error('Failed to save settings')

      const data = await res.json()
      setSettings(data)
      setSuccess(true)
      setTimeout(() => setSuccess(false), 3000)
    } catch (err) {
      setError('Failed to save settings')
      console.error(err)
    } finally {
      setSaving(false)
    }
  }

  function toggleDay(day: string) {
    if (!settings) return
    const days = settings.business_days.includes(day)
      ? settings.business_days.filter((d) => d !== day)
      : [...settings.business_days, day]
    setSettings({ ...settings, business_days: days })
  }

  function updateEndpoints(value: string) {
    if (!settings) return
    const endpoints = value
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    setSettings({ ...settings, sip_endpoints: endpoints })
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold">Phone Settings</h1>
          <p className="text-muted-foreground">Loading...</p>
        </div>
      </div>
    )
  }

  if (!settings) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold">Phone Settings</h1>
          <p className="text-red-500">
            Failed to load settings. Make sure the database migration has been
            run.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Phone Settings</h1>
          <p className="text-muted-foreground">
            Configure voicemail, business hours, and call routing
          </p>
        </div>
        <Button onClick={saveSettings} disabled={saving}>
          {saving ? 'Saving...' : 'Save Changes'}
        </Button>
      </div>

      {error && (
        <div className="rounded border border-red-400 bg-red-100 px-4 py-3 text-red-700">
          {error}
        </div>
      )}

      {success && (
        <div className="rounded border border-green-400 bg-green-100 px-4 py-3 text-green-700">
          Settings saved successfully!
        </div>
      )}

      <div className="grid gap-6">
        {/* Voicemail Settings */}
        <Card className="p-6">
          <h2 className="mb-4 text-xl font-semibold">Voicemail Settings</h2>

          <div className="space-y-4">
            <div>
              <Label htmlFor="voicemail_message">Voicemail Message</Label>
              <Textarea
                id="voicemail_message"
                value={settings.voicemail_message}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    voicemail_message: e.target.value,
                  })
                }
                rows={4}
                className="mt-1"
              />
              <p className="text-muted-foreground mt-1 text-sm">
                This message plays when calls go to voicemail (after hours or
                missed calls)
              </p>
            </div>

            <div>
              <Label htmlFor="voicemail_voice">Voice</Label>
              <Select
                value={settings.voicemail_voice}
                onValueChange={(value) =>
                  setSettings({ ...settings, voicemail_voice: value })
                }
              >
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {VOICE_OPTIONS.map((voice) => (
                    <SelectItem key={voice.value} value={voice.value}>
                      {voice.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </Card>

        {/* Business Hours */}
        <Card className="p-6">
          <h2 className="mb-4 text-xl font-semibold">Business Hours</h2>

          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="hours_start">Start Time</Label>
                <Select
                  value={settings.business_hours_start.toString()}
                  onValueChange={(value) =>
                    setSettings({
                      ...settings,
                      business_hours_start: parseInt(value),
                    })
                  }
                >
                  <SelectTrigger className="mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Array.from({ length: 24 }, (_, i) => (
                      <SelectItem key={i} value={i.toString()}>
                        {i === 0
                          ? '12:00 AM'
                          : i < 12
                            ? `${i}:00 AM`
                            : i === 12
                              ? '12:00 PM'
                              : `${i - 12}:00 PM`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label htmlFor="hours_end">End Time</Label>
                <Select
                  value={settings.business_hours_end.toString()}
                  onValueChange={(value) =>
                    setSettings({
                      ...settings,
                      business_hours_end: parseInt(value),
                    })
                  }
                >
                  <SelectTrigger className="mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Array.from({ length: 24 }, (_, i) => (
                      <SelectItem key={i} value={i.toString()}>
                        {i === 0
                          ? '12:00 AM'
                          : i < 12
                            ? `${i}:00 AM`
                            : i === 12
                              ? '12:00 PM'
                              : `${i - 12}:00 PM`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div>
              <Label>Business Days</Label>
              <div className="mt-2 flex flex-wrap gap-4">
                {WEEKDAYS.map((day) => (
                  <div key={day} className="flex items-center space-x-2">
                    <Checkbox
                      id={day}
                      checked={settings.business_days.includes(day)}
                      onCheckedChange={() => toggleDay(day)}
                    />
                    <label htmlFor={day} className="text-sm">
                      {day}
                    </label>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </Card>

        {/* Call Routing */}
        <Card className="p-6">
          <h2 className="mb-4 text-xl font-semibold">Call Routing</h2>

          <div className="space-y-4">
            <div>
              <Label htmlFor="sip_endpoints">
                SIP Endpoints (comma-separated usernames)
              </Label>
              <Input
                id="sip_endpoints"
                value={settings.sip_endpoints.join(', ')}
                onChange={(e) => updateEndpoints(e.target.value)}
                placeholder="chuck, wife"
                className="mt-1"
              />
              <p className="text-muted-foreground mt-1 text-sm">
                These phones will ring simultaneously when a call comes in
                during business hours
              </p>
            </div>

            <div>
              <Label htmlFor="sip_domain">SIP Domain</Label>
              <Input
                id="sip_domain"
                value={settings.sip_domain}
                onChange={(e) =>
                  setSettings({ ...settings, sip_domain: e.target.value })
                }
                className="mt-1"
              />
            </div>

            <div>
              <Label htmlFor="dial_timeout">Ring Timeout (seconds)</Label>
              <Input
                id="dial_timeout"
                type="number"
                min="5"
                max="60"
                value={settings.dial_timeout}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    dial_timeout: parseInt(e.target.value) || 20,
                  })
                }
                className="mt-1 w-32"
              />
              <p className="text-muted-foreground mt-1 text-sm">
                How long phones ring before going to voicemail
              </p>
            </div>
          </div>
        </Card>

        {/* Last Updated */}
        <p className="text-muted-foreground text-sm">
          Last updated: {new Date(settings.updated_at).toLocaleString()}
        </p>
      </div>
    </div>
  )
}
