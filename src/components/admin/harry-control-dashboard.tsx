'use client'

import { useEffect, useMemo, useState } from 'react'
import { Loader2, Power, RefreshCw, Save } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'

type HarrySetting = {
  id?: string
  setting_key: string
  group_key: string
  label: string
  description: string
  is_enabled: boolean
  updated_at?: string
}

type HarryProfile = {
  id: string
  profile_key: string
  label: string
  channel_key: string
  booking_mode: string
  prompt_overrides: string
  is_enabled: boolean
}

type HarryKnowledgeBlock = {
  id: string
  category_key: string
  title: string
  content: string
  is_enabled: boolean
  sort_order: number
}

type RuntimeResponse = {
  ai_dispatcher_enabled: boolean
  analyst_enabled: boolean
  analyst_history_readonly: boolean
  booking_destination_mode?: 'website' | 'ops'
  booking_website_url?: string
  booking_ops_url?: string
  booking_active_url?: string
}

const GROUP_LABELS: Record<string, string> = {
  safety: 'Safety Controls',
  inbound: 'Inbound Intake',
  reply: 'Reply Controls',
  booking: 'Booking Controls',
  escalation: 'Escalation Controls',
  notifications: 'Notifications',
  calls: 'Call Automation',
  channels: 'Channel Mapping',
}

export function HarryControlDashboard() {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [settings, setSettings] = useState<HarrySetting[]>([])
  const [profiles, setProfiles] = useState<HarryProfile[]>([])
  const [knowledgeBlocks, setKnowledgeBlocks] = useState<HarryKnowledgeBlock[]>(
    [],
  )
  const [runtime, setRuntime] = useState<RuntimeResponse | null>(null)

  const loadData = async () => {
    setLoading(true)
    setError(null)
    try {
      const [controlRes, profilesRes, knowledgeRes] = await Promise.all([
        fetch('/api/admin/harry/control', { cache: 'no-store' }),
        fetch('/api/admin/harry/profiles', { cache: 'no-store' }),
        fetch('/api/admin/harry/knowledge', { cache: 'no-store' }),
      ])

      const [controlData, profilesData, knowledgeData] = await Promise.all([
        controlRes.json(),
        profilesRes.json(),
        knowledgeRes.json(),
      ])

      if (!controlRes.ok) {
        throw new Error(controlData.error || 'Failed to load Harry control')
      }
      if (!profilesRes.ok) {
        throw new Error(profilesData.error || 'Failed to load Harry profiles')
      }
      if (!knowledgeRes.ok) {
        throw new Error(
          knowledgeData.error || 'Failed to load Harry knowledge blocks',
        )
      }

      setSettings(controlData.settings || [])
      setRuntime(controlData.runtime || null)
      setProfiles(profilesData.profiles || [])
      setKnowledgeBlocks(knowledgeData.blocks || [])
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : 'Failed to load Harry controls',
      )
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadData()
  }, [])

  const groupedSettings = useMemo(() => {
    const grouped = new Map<string, HarrySetting[]>()
    for (const setting of settings) {
      const existing = grouped.get(setting.group_key) || []
      grouped.set(setting.group_key, [...existing, setting])
    }
    return grouped
  }, [settings])

  const updateSetting = async (setting: HarrySetting, nextEnabled: boolean) => {
    setSaving(`setting:${setting.setting_key}`)
    setError(null)
    try {
      const response = await fetch('/api/admin/harry/control', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          setting_key: setting.setting_key,
          is_enabled: nextEnabled,
        }),
      })
      const result = await response.json()
      if (!response.ok) {
        throw new Error(result.error || 'Failed to update setting')
      }
      setSettings(result.settings || [])
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : 'Failed to update Harry setting',
      )
    } finally {
      setSaving(null)
    }
  }

  const updateProfile = async (profile: HarryProfile) => {
    setSaving(`profile:${profile.profile_key}`)
    setError(null)
    try {
      const response = await fetch('/api/admin/harry/profiles', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(profile),
      })
      const result = await response.json()
      if (!response.ok) {
        throw new Error(result.error || 'Failed to update profile')
      }
      setProfiles(result.profiles || [])
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : 'Failed to update profile',
      )
    } finally {
      setSaving(null)
    }
  }

  const updateKnowledgeBlock = async (block: HarryKnowledgeBlock) => {
    setSaving(`knowledge:${block.category_key}`)
    setError(null)
    try {
      const response = await fetch('/api/admin/harry/knowledge', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(block),
      })
      const result = await response.json()
      if (!response.ok) {
        throw new Error(result.error || 'Failed to update knowledge block')
      }
      setKnowledgeBlocks(result.blocks || [])
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : 'Failed to update knowledge block',
      )
    } finally {
      setSaving(null)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading Harry controls...
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <Card className="border-border/60 bg-card/80 p-6 shadow-sm backdrop-blur">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-2xl font-semibold">Harry Control Dashboard</h2>
            <p className="text-muted-foreground mt-1 text-sm">
              Central runtime controls for inbound automation, booking-link
              behavior, channel logic, and editable knowledge used by Harry in
              live SMS.
            </p>
          </div>
          <Button
            variant="outline"
            onClick={() => void loadData()}
            disabled={Boolean(saving)}
          >
            <RefreshCw className="mr-2 h-4 w-4" />
            Refresh
          </Button>
        </div>
      </Card>

      {error ? (
        <Card className="border-destructive/30 bg-destructive/10 text-destructive p-4 text-sm">
          {error}
        </Card>
      ) : null}

      <Card className="border-border/60 bg-card/80 p-6 shadow-sm backdrop-blur">
        <h3 className="text-lg font-semibold">Runtime Status</h3>
        <p className="text-muted-foreground mt-1 text-sm">
          These values show environment-level gates that can still override
          dashboard toggles. If a value is OFF here, related Harry features stay
          unavailable even if a function toggle is ON.
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-4">
          <div className="border-border/60 bg-background/70 rounded-xl border p-3">
            <div className="text-muted-foreground text-xs uppercase">
              AI Dispatcher Env
            </div>
            <div className="mt-1">
              <Badge variant="outline">
                {runtime?.ai_dispatcher_enabled ? 'ON' : 'OFF'}
              </Badge>
            </div>
          </div>
          <div className="border-border/60 bg-background/70 rounded-xl border p-3">
            <div className="text-muted-foreground text-xs uppercase">
              Analyst Feature
            </div>
            <div className="mt-1">
              <Badge variant="outline">
                {runtime?.analyst_enabled ? 'ENABLED' : 'DISABLED'}
              </Badge>
            </div>
          </div>
          <div className="border-border/60 bg-background/70 rounded-xl border p-3">
            <div className="text-muted-foreground text-xs uppercase">
              Analyst History Access
            </div>
            <div className="mt-1">
              <Badge variant="outline">
                {runtime?.analyst_history_readonly ? 'READ ONLY' : 'DISABLED'}
              </Badge>
            </div>
          </div>
          <div className="border-border/60 bg-background/70 rounded-xl border p-3">
            <div className="text-muted-foreground text-xs uppercase">
              Booking Destination
            </div>
            <div className="mt-1 flex flex-col gap-1">
              <Badge variant="outline">
                {(runtime?.booking_destination_mode || 'website').toUpperCase()}
              </Badge>
              <div className="text-muted-foreground text-[11px] break-all">
                Active: {runtime?.booking_active_url || 'not set'}
              </div>
            </div>
          </div>
        </div>
      </Card>

      <Card className="border-border/60 bg-card/80 p-6 shadow-sm backdrop-blur">
        <div className="flex items-center gap-2">
          <Power className="h-4 w-4" />
          <h3 className="text-lg font-semibold">Function Toggles</h3>
        </div>
        <p className="text-muted-foreground mt-1 text-sm">
          Use these to control live behavior without redeploying. Every toggle
          applies immediately to new inbound events and keeps existing data
          intact.
        </p>
        <div className="mt-4 space-y-6">
          {[...groupedSettings.entries()].map(([groupKey, rows]) => (
            <div key={groupKey}>
              <h4 className="text-sm font-semibold tracking-wide uppercase">
                {GROUP_LABELS[groupKey] || groupKey}
              </h4>
              <div className="mt-2 grid gap-2">
                {rows.map((setting) => {
                  const isUpdating = saving === `setting:${setting.setting_key}`
                  return (
                    <div
                      key={setting.setting_key}
                      className="border-border/60 bg-background/70 flex items-start justify-between rounded-xl border p-3"
                    >
                      <div className="pr-3">
                        <div className="font-medium">{setting.label}</div>
                        <div className="text-muted-foreground text-xs">
                          {setting.description}
                        </div>
                      </div>
                      <Button
                        size="sm"
                        variant={setting.is_enabled ? 'default' : 'outline'}
                        disabled={Boolean(saving)}
                        onClick={() =>
                          void updateSetting(setting, !setting.is_enabled)
                        }
                      >
                        {isUpdating ? (
                          <Loader2 className="mr-2 h-3 w-3 animate-spin" />
                        ) : null}
                        {setting.is_enabled ? 'ON' : 'OFF'}
                      </Button>
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      </Card>

      <Card className="border-border/60 bg-card/80 p-6 shadow-sm backdrop-blur">
        <h3 className="text-lg font-semibold">Booking Switch Notes</h3>
        <div className="text-muted-foreground mt-2 space-y-1 text-sm">
          <p>
            Current behavior: the booking destination switch only changes links
            sent by Harry inside automated SMS replies.
          </p>
          <p>
            Not covered yet: website CTA buttons, manually sent SMS templates,
            and any non-Harry booking surfaces still use their existing
            destinations.
          </p>
          <p>
            Ops mode requires an `OPS_BOOKING_PUBLIC_URL` environment value to
            route to the new operations booking flow.
          </p>
          <p>Website URL: {runtime?.booking_website_url || 'not set'}</p>
          <p>Ops URL: {runtime?.booking_ops_url || 'not set'}</p>
        </div>
      </Card>

      <Card className="border-border/60 bg-card/80 p-6 shadow-sm backdrop-blur">
        <h3 className="text-lg font-semibold">Channel Logic Profiles</h3>
        <p className="text-muted-foreground mt-1 text-sm">
          Profiles define channel-specific behavior, including tone and context
          handling differences (inbound vs contest vs vendor vs business card),
          while keeping the same qualification guardrails.
        </p>
        <div className="mt-4 grid gap-3">
          {profiles.map((profile) => {
            const isUpdating = saving === `profile:${profile.profile_key}`
            return (
              <div
                key={profile.id}
                className="border-border/60 bg-background/70 rounded-xl border p-3"
              >
                <div className="grid gap-3 md:grid-cols-3">
                  <div>
                    <div className="text-muted-foreground text-xs uppercase">
                      Profile
                    </div>
                    <Input
                      value={profile.label}
                      onChange={(event) =>
                        setProfiles((current) =>
                          current.map((row) =>
                            row.id === profile.id
                              ? { ...row, label: event.target.value }
                              : row,
                          ),
                        )
                      }
                    />
                  </div>
                  <div>
                    <div className="text-muted-foreground text-xs uppercase">
                      Channel
                    </div>
                    <Input
                      value={profile.channel_key}
                      onChange={(event) =>
                        setProfiles((current) =>
                          current.map((row) =>
                            row.id === profile.id
                              ? { ...row, channel_key: event.target.value }
                              : row,
                          ),
                        )
                      }
                    />
                  </div>
                  <div>
                    <div className="text-muted-foreground text-xs uppercase">
                      Booking Mode
                    </div>
                    <Input
                      value={profile.booking_mode}
                      onChange={(event) =>
                        setProfiles((current) =>
                          current.map((row) =>
                            row.id === profile.id
                              ? { ...row, booking_mode: event.target.value }
                              : row,
                          ),
                        )
                      }
                    />
                  </div>
                </div>
                <div className="mt-3">
                  <div className="text-muted-foreground text-xs uppercase">
                    Prompt Overrides / Logic Notes
                  </div>
                  <Textarea
                    value={profile.prompt_overrides}
                    onChange={(event) =>
                      setProfiles((current) =>
                        current.map((row) =>
                          row.id === profile.id
                            ? { ...row, prompt_overrides: event.target.value }
                            : row,
                        ),
                      )
                    }
                    placeholder="Channel-specific instructions for Harry."
                  />
                </div>
                <div className="mt-3 flex items-center justify-between">
                  <Button
                    size="sm"
                    variant={profile.is_enabled ? 'default' : 'outline'}
                    onClick={() =>
                      setProfiles((current) =>
                        current.map((row) =>
                          row.id === profile.id
                            ? { ...row, is_enabled: !row.is_enabled }
                            : row,
                        ),
                      )
                    }
                  >
                    {profile.is_enabled ? 'Enabled' : 'Disabled'}
                  </Button>
                  <Button
                    size="sm"
                    disabled={Boolean(saving)}
                    onClick={() => void updateProfile(profile)}
                  >
                    {isUpdating ? (
                      <Loader2 className="mr-2 h-3 w-3 animate-spin" />
                    ) : (
                      <Save className="mr-2 h-3 w-3" />
                    )}
                    Save Profile
                  </Button>
                </div>
              </div>
            )
          })}
        </div>
      </Card>

      <Card className="border-border/60 bg-card/80 p-6 shadow-sm backdrop-blur">
        <h3 className="text-lg font-semibold">Knowledge Categories</h3>
        <p className="text-muted-foreground mt-1 text-sm">
          Edit the live policy and pricing context appended to Harry prompts.
          These blocks let you tune responses without touching code, and each
          block can be enabled or disabled independently.
        </p>
        <div className="mt-4 grid gap-3">
          {knowledgeBlocks.map((block) => {
            const isUpdating = saving === `knowledge:${block.category_key}`
            return (
              <div
                key={block.id}
                className="border-border/60 bg-background/70 rounded-xl border p-3"
              >
                <div className="grid gap-3 md:grid-cols-[1fr,140px]">
                  <Input
                    value={block.title}
                    onChange={(event) =>
                      setKnowledgeBlocks((current) =>
                        current.map((row) =>
                          row.id === block.id
                            ? { ...row, title: event.target.value }
                            : row,
                        ),
                      )
                    }
                  />
                  <Button
                    size="sm"
                    variant={block.is_enabled ? 'default' : 'outline'}
                    onClick={() =>
                      setKnowledgeBlocks((current) =>
                        current.map((row) =>
                          row.id === block.id
                            ? { ...row, is_enabled: !row.is_enabled }
                            : row,
                        ),
                      )
                    }
                  >
                    {block.is_enabled ? 'Enabled' : 'Disabled'}
                  </Button>
                </div>
                <Textarea
                  className="mt-3 min-h-[110px]"
                  value={block.content}
                  onChange={(event) =>
                    setKnowledgeBlocks((current) =>
                      current.map((row) =>
                        row.id === block.id
                          ? { ...row, content: event.target.value }
                          : row,
                      ),
                    )
                  }
                  placeholder="Add rules, examples, and constraints for this category."
                />
                <div className="mt-3 flex justify-end">
                  <Button
                    size="sm"
                    disabled={Boolean(saving)}
                    onClick={() => void updateKnowledgeBlock(block)}
                  >
                    {isUpdating ? (
                      <Loader2 className="mr-2 h-3 w-3 animate-spin" />
                    ) : (
                      <Save className="mr-2 h-3 w-3" />
                    )}
                    Save Knowledge
                  </Button>
                </div>
              </div>
            )
          })}
        </div>
      </Card>
    </div>
  )
}
