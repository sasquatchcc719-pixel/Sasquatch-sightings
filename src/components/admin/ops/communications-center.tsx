'use client'

import { useEffect, useMemo, useState } from 'react'
import { Loader2, Mail, MessageSquare, Save } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'

type TemplateRow = {
  id: string
  template_key: string
  channel: 'sms' | 'email'
  label: string
  is_enabled: boolean
  subject_template: string | null
  body_template: string
  delay_hours: number
}

const EMAIL_TEMPLATE_KEYS_WITH_DELAY = new Set(['satisfaction_checkin_email'])

function groupTitle(channel: 'sms' | 'email') {
  return channel === 'sms' ? 'Text Messaging' : 'Email'
}

export function CommunicationsCenter() {
  const [loading, setLoading] = useState(true)
  const [savingKey, setSavingKey] = useState<string | null>(null)
  const [runningReminders, setRunningReminders] = useState(false)
  const [runMessage, setRunMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [templates, setTemplates] = useState<TemplateRow[]>([])

  useEffect(() => {
    async function loadTemplates() {
      setLoading(true)
      setError(null)
      try {
        const response = await fetch(
          '/api/admin/ops/communications/templates',
          {
            cache: 'no-store',
          },
        )
        const result = await response.json()
        if (!response.ok) {
          throw new Error(result.error || 'Failed to load communications')
        }
        setTemplates(result.templates || [])
      } catch (loadError) {
        setError(
          loadError instanceof Error
            ? loadError.message
            : 'Failed to load communications',
        )
      } finally {
        setLoading(false)
      }
    }

    void loadTemplates()
  }, [])

  const grouped = useMemo(
    () => ({
      sms: templates.filter((template) => template.channel === 'sms'),
      email: templates.filter((template) => template.channel === 'email'),
    }),
    [templates],
  )

  const saveTemplate = async (template: TemplateRow) => {
    setSavingKey(template.template_key)
    setError(null)
    try {
      const response = await fetch('/api/admin/ops/communications/templates', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          template_key: template.template_key,
          is_enabled: template.is_enabled,
          subject_template: template.subject_template,
          body_template: template.body_template,
          delay_hours: template.delay_hours,
        }),
      })
      const result = await response.json()
      if (!response.ok) {
        throw new Error(result.error || 'Failed to save template')
      }
      setTemplates((current) =>
        current.map((item) =>
          item.template_key === template.template_key ? result.template : item,
        ),
      )
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : 'Failed to save template',
      )
    } finally {
      setSavingKey(null)
    }
  }

  const runDayBeforeReminders = async () => {
    setRunningReminders(true)
    setRunMessage(null)
    setError(null)
    try {
      const response = await fetch(
        '/api/admin/ops/communications/day-before-reminders',
        {
          method: 'POST',
        },
      )
      const result = await response.json()
      if (!response.ok) {
        throw new Error(result.error || 'Failed to run reminders')
      }

      const summary = result.result || {}
      setRunMessage(
        `Checked ${summary.checked || 0}, sent ${summary.sent || 0}, skipped duplicates ${summary.skipped_duplicate || 0}, skipped disabled ${summary.skipped_template_disabled || 0}.`,
      )
    } catch (runError) {
      setError(
        runError instanceof Error
          ? runError.message
          : 'Failed to run reminders',
      )
    } finally {
      setRunningReminders(false)
    }
  }

  if (loading) {
    return (
      <div className="text-muted-foreground flex items-center gap-3">
        <Loader2 className="h-5 w-5 animate-spin" />
        Loading communications...
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {error ? (
        <Card className="border-destructive/30 bg-destructive/10 text-destructive p-4 text-sm">
          {error}
        </Card>
      ) : null}

      <Card className="animate-slide-up border-border/60 bg-card/80 p-5 shadow-sm backdrop-blur">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-gradient-purple text-2xl font-bold tracking-tight">
              Communications Center
            </h2>
            <p className="text-muted-foreground mt-2 text-sm">
              Edit the automatic job lifecycle messages and toggle each one on
              when you are ready. All templates start disabled by default.
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            onClick={() => void runDayBeforeReminders()}
            disabled={runningReminders}
            className="gap-2"
          >
            {runningReminders ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <MessageSquare className="h-4 w-4" />
            )}
            Run Day-Before Reminders Now
          </Button>
        </div>
      </Card>

      {runMessage ? (
        <Card className="border-border/60 bg-card/80 p-4 text-sm shadow-sm backdrop-blur">
          {runMessage}
        </Card>
      ) : null}

      {(['sms', 'email'] as const).map((channel) => (
        <div key={channel} className="space-y-4">
          <div className="flex items-center gap-2">
            {channel === 'sms' ? (
              <MessageSquare className="h-5 w-5 text-cyan-400" />
            ) : (
              <Mail className="h-5 w-5 text-purple-400" />
            )}
            <h3 className="text-xl font-semibold tracking-tight">
              {groupTitle(channel)}
            </h3>
          </div>

          <div className="grid gap-4">
            {grouped[channel].map((template) => {
              const isSaving = savingKey === template.template_key
              return (
                <Card
                  key={template.template_key}
                  className={`accent-border-left border-border/60 bg-card/80 p-5 shadow-sm backdrop-blur ${channel === 'sms' ? 'border-l-cyan-500/60' : 'border-l-purple-500/60'}`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="text-lg font-semibold">
                        {template.label}
                      </div>
                      <div className="text-muted-foreground mt-1 text-sm">
                        Key: <code>{template.template_key}</code>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge
                        variant={template.is_enabled ? 'default' : 'outline'}
                      >
                        {template.is_enabled ? 'On' : 'Off'}
                      </Badge>
                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={template.is_enabled}
                          onChange={(event) =>
                            setTemplates((current) =>
                              current.map((row) =>
                                row.template_key === template.template_key
                                  ? { ...row, is_enabled: event.target.checked }
                                  : row,
                              ),
                            )
                          }
                        />
                        Enabled
                      </label>
                    </div>
                  </div>

                  <div className="mt-4 space-y-3">
                    {template.channel === 'email' ? (
                      <div>
                        <Label htmlFor={`subject-${template.template_key}`}>
                          Subject
                        </Label>
                        <Input
                          id={`subject-${template.template_key}`}
                          value={template.subject_template || ''}
                          onChange={(event) =>
                            setTemplates((current) =>
                              current.map((row) =>
                                row.template_key === template.template_key
                                  ? {
                                      ...row,
                                      subject_template: event.target.value,
                                    }
                                  : row,
                              ),
                            )
                          }
                        />
                      </div>
                    ) : null}

                    <div>
                      <Label htmlFor={`body-${template.template_key}`}>
                        Body
                      </Label>
                      <Textarea
                        id={`body-${template.template_key}`}
                        className="min-h-40"
                        value={template.body_template}
                        onChange={(event) =>
                          setTemplates((current) =>
                            current.map((row) =>
                              row.template_key === template.template_key
                                ? { ...row, body_template: event.target.value }
                                : row,
                            ),
                          )
                        }
                      />
                    </div>

                    {EMAIL_TEMPLATE_KEYS_WITH_DELAY.has(
                      template.template_key,
                    ) ? (
                      <div className="max-w-xs">
                        <Label htmlFor={`delay-${template.template_key}`}>
                          Delay (hours)
                        </Label>
                        <Input
                          id={`delay-${template.template_key}`}
                          type="number"
                          value={String(template.delay_hours || 0)}
                          onChange={(event) =>
                            setTemplates((current) =>
                              current.map((row) =>
                                row.template_key === template.template_key
                                  ? {
                                      ...row,
                                      delay_hours: Number(
                                        event.target.value || 0,
                                      ),
                                    }
                                  : row,
                              ),
                            )
                          }
                        />
                      </div>
                    ) : null}

                    <div className="flex justify-end">
                      <Button
                        onClick={() => void saveTemplate(template)}
                        disabled={isSaving}
                        className="gap-2"
                      >
                        {isSaving ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Save className="h-4 w-4" />
                        )}
                        Save template
                      </Button>
                    </div>
                  </div>
                </Card>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}
