'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Activity,
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  Clock3,
  DollarSign,
  MapPin,
  MessageSquareText,
  PauseCircle,
  RefreshCw,
  Save,
  Send,
  Settings2,
  ShieldCheck,
  Sparkles,
  Users,
  X,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { tomorrowFillWaveLimit } from '@/lib/ops/tomorrow-fill-rules'

type Settings = {
  engine_enabled: boolean
  send_enabled: boolean
  dormancy_months: number
  customer_cooldown_days: number
  unanswered_limit: number
  rest_days: number
  minimum_audience_size: number
  default_wave_size: number
  max_discounted_bookings: number
  offer_code: string
  offer_amount: number
  minimum_subtotal: number
  offer_valid_days: number
  message_template: string
}

type Campaign = {
  id: string
  target_date: string
  status: string
  selected_zips: string[]
  openings: {
    startTime?: string
    endTime?: string
    staffName?: string
    start_time?: string
    end_time?: string
    staff_name?: string
  }[]
  exclusion_counts: Record<string, number>
  open_minutes: number
  booked_minutes: number
  eligible_count: number
  sent_count: number
  failed_count: number
  booked_count: number
  attributed_revenue: number
  offer_code: string
  offer_amount: number
  minimum_subtotal: number
  message_template: string
  created_at: string
}

type Recipient = {
  id: string
  phone_normalized: string
  zip_code: string
  last_clean_date: string
  lifetime_value: number
  rank: number
  status: string
  exclusion_reason: string | null
  sent_at: string | null
  clicked_at: string | null
  replied_at: string | null
  booked_at: string | null
  booking_total: number | null
  appointment_id: string | null
  ops_customers:
    | { full_name: string; first_name: string | null; last_name: string | null }
    | {
        full_name: string
        first_name: string | null
        last_name: string | null
      }[]
}

type EventRow = {
  id: string
  event_type: string
  actor: string | null
  detail: Record<string, unknown>
  created_at: string
}

type DashboardData = {
  settings: Settings
  campaigns: Campaign[]
  selectedCampaignId: string | null
  recipients: Recipient[]
  events: EventRow[]
}

function relationOne<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? value[0] || null : value || null
}

function dateLabel(value: string) {
  return new Date(`${value}T12:00:00`).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  })
}

function timeLabel(value?: string) {
  if (!value || !/^\d{1,2}:\d{2}/.test(value)) return 'Time unavailable'
  const [hours, minutes] = value.split(':').map(Number)
  return new Date(2026, 0, 1, hours, minutes).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  })
}

function money(value: number | null | undefined) {
  return Number(value || 0).toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  })
}

function statusTone(status: string) {
  if (['active', 'booked', 'filled'].includes(status))
    return 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
  if (['failed', 'suppressed'].includes(status))
    return 'bg-red-500/15 text-red-700 dark:text-red-300'
  if (['sent', 'clicked', 'replied', 'sending'].includes(status))
    return 'bg-blue-500/15 text-blue-700 dark:text-blue-300'
  return 'bg-amber-500/15 text-amber-800 dark:text-amber-300'
}

function Switch({
  checked,
  onChange,
  label,
}: {
  checked: boolean
  onChange: (value: boolean) => void
  label: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative h-7 w-12 rounded-full transition ${checked ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-slate-700'}`}
    >
      <span
        className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition ${checked ? 'left-6' : 'left-1'}`}
      />
    </button>
  )
}

export function TomorrowFillControlCenter() {
  const [data, setData] = useState<DashboardData | null>(null)
  const [draft, setDraft] = useState<Settings | null>(null)
  const [loading, setLoading] = useState(true)
  const [working, setWorking] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [selectedCampaignId, setSelectedCampaignId] = useState<string | null>(
    null,
  )
  const [reviewAmount, setReviewAmount] = useState<5 | 10 | 15 | null>(null)

  const load = useCallback(async (campaignId?: string | null) => {
    setLoading(true)
    setError('')
    try {
      const query = campaignId
        ? `?campaign=${encodeURIComponent(campaignId)}`
        : ''
      const response = await fetch(`/api/admin/ops/tomorrow-fill${query}`, {
        cache: 'no-store',
      })
      const body = await response.json()
      if (!response.ok)
        throw new Error(body.error || 'Unable to load Tomorrow Fill.')
      setData(body)
      setDraft(body.settings)
      setSelectedCampaignId(body.selectedCampaignId)
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : 'Unable to load Tomorrow Fill.',
      )
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const campaign = new URLSearchParams(window.location.search).get('campaign')
    void load(campaign)
  }, [load])

  const selectedCampaign = useMemo(
    () =>
      data?.campaigns.find((campaign) => campaign.id === selectedCampaignId) ||
      null,
    [data, selectedCampaignId],
  )

  const reviewRecipients = useMemo(() => {
    if (!reviewAmount || !data) return []
    const eligible = data.recipients.filter(
      (recipient) => recipient.status === 'eligible',
    )
    return eligible.slice(0, reviewAmount)
  }, [data, reviewAmount])

  async function mutate(body: Record<string, unknown>, successMessage: string) {
    setWorking(String(body.action || 'save'))
    setError('')
    setNotice('')
    try {
      const response = await fetch('/api/admin/ops/tomorrow-fill', {
        method: body.action ? 'POST' : 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Action failed.')
      setNotice(successMessage)
      setReviewAmount(null)
      const campaignId = result.result?.campaignId || selectedCampaignId
      await load(campaignId)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Action failed.')
    } finally {
      setWorking('')
    }
  }

  function setSetting<K extends keyof Settings>(key: K, value: Settings[K]) {
    setDraft((current) => (current ? { ...current, [key]: value } : current))
  }

  if (loading && !data) {
    return (
      <div className="text-muted-foreground flex min-h-[460px] items-center justify-center">
        <RefreshCw className="mr-2 h-5 w-5 animate-spin" /> Loading Tomorrow
        Fill…
      </div>
    )
  }
  if (!data || !draft) {
    return (
      <Card className="border-red-500/20">
        <CardContent className="p-6 text-red-600">
          {error || 'Tomorrow Fill is unavailable.'}
        </CardContent>
      </Card>
    )
  }

  const remaining = data.recipients.filter(
    (recipient) => recipient.status === 'eligible',
  ).length
  const clicked = data.recipients.filter(
    (recipient) => recipient.clicked_at,
  ).length
  const replied = data.recipients.filter(
    (recipient) => recipient.replied_at,
  ).length
  const capacityHours = Number(selectedCampaign?.open_minutes || 0) / 60
  const safeWaveLimit = tomorrowFillWaveLimit(
    selectedCampaign?.openings?.length || 0,
  )

  return (
    <div className="max-w-full min-w-0 space-y-6 overflow-x-hidden pb-16">
      <section className="relative overflow-hidden rounded-[28px] border border-emerald-500/20 bg-[#071c17] p-6 text-white shadow-xl shadow-emerald-950/10 sm:p-8">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_85%_10%,rgba(52,211,153,.17),transparent_30%),radial-gradient(circle_at_10%_95%,rgba(245,158,11,.1),transparent_28%)]" />
        <div className="relative flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
          <div className="max-w-3xl">
            <div className="flex flex-wrap items-center gap-2">
              <Badge
                className={
                  draft.send_enabled
                    ? 'bg-emerald-400 text-emerald-950'
                    : 'bg-amber-300 text-amber-950'
                }
              >
                {draft.send_enabled ? 'LIVE SENDING' : 'PREVIEW ONLY'}
              </Badge>
              <span className="text-xs font-semibold tracking-widest text-white/45 uppercase">
                Deterministic customer reactivation
              </span>
            </div>
            <h1 className="mt-4 text-3xl font-black tracking-[-0.035em] sm:text-5xl">
              Tomorrow Fill
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-white/62 sm:text-base">
              Turn tomorrow&apos;s route gaps into booked work—using exact ZIP
              matches, your customer history, and controls you can audit before
              a single text leaves the system.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:min-w-[530px]">
            {[
              [CalendarClock, `${capacityHours}h`, 'Open capacity'],
              [Users, selectedCampaign?.eligible_count || 0, 'Eligible'],
              [MessageSquareText, selectedCampaign?.sent_count || 0, 'Texted'],
              [
                DollarSign,
                money(selectedCampaign?.attributed_revenue),
                'Booked revenue',
              ],
            ].map(([Icon, value, label]) => {
              const MetricIcon = Icon as typeof Users
              return (
                <div
                  key={String(label)}
                  className="rounded-2xl border border-white/10 bg-white/[0.055] p-4 backdrop-blur"
                >
                  <MetricIcon className="h-4 w-4 text-emerald-300" />
                  <p className="mt-3 text-2xl font-black">{String(value)}</p>
                  <p className="mt-1 text-[11px] font-medium text-white/45">
                    {String(label)}
                  </p>
                </div>
              )
            })}
          </div>
        </div>
      </section>

      {(error || notice) && (
        <div
          className={`rounded-xl border px-4 py-3 text-sm font-medium ${error ? 'border-red-500/20 bg-red-500/8 text-red-700 dark:text-red-300' : 'border-emerald-500/20 bg-emerald-500/8 text-emerald-700 dark:text-emerald-300'}`}
        >
          {error || notice}
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.45fr)_minmax(360px,.75fr)]">
        <div className="min-w-0 space-y-6">
          <Card className="border-border/60 overflow-hidden shadow-sm">
            <CardHeader className="bg-muted/20 border-b">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <Sparkles className="h-5 w-5 text-amber-500" />{' '}
                    Tomorrow&apos;s opportunity
                  </CardTitle>
                  <p className="text-muted-foreground mt-1 text-sm">
                    Scan, inspect the audience, then choose an exact wave size.
                  </p>
                </div>
                <Button
                  variant="outline"
                  disabled={working === 'scan'}
                  onClick={() =>
                    void mutate(
                      { action: 'scan' },
                      'Tomorrow was scanned without sending any texts.',
                    )
                  }
                >
                  <RefreshCw
                    className={`mr-2 h-4 w-4 ${working === 'scan' ? 'animate-spin' : ''}`}
                  />{' '}
                  Scan tomorrow now
                </Button>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {data.campaigns.length === 0 ? (
                <div className="text-muted-foreground p-10 text-center">
                  <CalendarClock className="mx-auto mb-3 h-8 w-8 opacity-50" />
                  <p className="text-foreground font-semibold">No scan yet</p>
                  <p className="mt-1 text-sm">
                    The 9:00 AM Mountain scan will appear here, or run a preview
                    now.
                  </p>
                </div>
              ) : (
                <div className="flex gap-2 overflow-x-auto border-b p-3">
                  {data.campaigns.slice(0, 8).map((campaign) => (
                    <button
                      key={campaign.id}
                      onClick={() => void load(campaign.id)}
                      className={`min-w-[145px] rounded-xl border p-3 text-left transition ${campaign.id === selectedCampaignId ? 'border-emerald-500 bg-emerald-500/8' : 'border-border hover:bg-muted/50'}`}
                    >
                      <p className="text-sm font-bold">
                        {dateLabel(campaign.target_date)}
                      </p>
                      <div className="mt-2 flex items-center justify-between">
                        <span className="text-muted-foreground text-xs">
                          {campaign.eligible_count} eligible
                        </span>
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${statusTone(campaign.status)}`}
                        >
                          {campaign.status.replaceAll('_', ' ')}
                        </span>
                      </div>
                    </button>
                  ))}
                </div>
              )}

              {selectedCampaign && (
                <div className="space-y-5 p-5 sm:p-6">
                  <div className="grid gap-3 sm:grid-cols-3">
                    <div className="bg-muted/20 rounded-xl border p-4">
                      <p className="text-muted-foreground text-xs font-semibold uppercase">
                        Route ZIPs
                      </p>
                      <p className="mt-2 flex items-center gap-2 font-bold">
                        <MapPin className="h-4 w-4 text-emerald-600" />{' '}
                        {selectedCampaign.selected_zips.join(', ')}
                      </p>
                    </div>
                    <div className="bg-muted/20 rounded-xl border p-4">
                      <p className="text-muted-foreground text-xs font-semibold uppercase">
                        Bookable windows
                      </p>
                      <p className="mt-2 font-bold">
                        {selectedCampaign.openings?.length || 0} windows ·{' '}
                        {capacityHours} hours
                      </p>
                    </div>
                    <div className="bg-muted/20 rounded-xl border p-4">
                      <p className="text-muted-foreground text-xs font-semibold uppercase">
                        Safety stop
                      </p>
                      <p className="mt-2 font-bold">
                        {selectedCampaign.booked_count}/
                        {draft.max_discounted_bookings} bookings ·{' '}
                        {Math.round(
                          Number(selectedCampaign.booked_minutes || 0) / 60,
                        )}
                        h filled
                      </p>
                    </div>
                  </div>

                  {selectedCampaign.openings?.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {selectedCampaign.openings.map((opening, index) => {
                        const startTime =
                          opening.startTime || opening.start_time
                        const endTime = opening.endTime || opening.end_time
                        const staffName =
                          opening.staffName || opening.staff_name
                        return (
                          <span
                            key={`${startTime || 'opening'}-${index}`}
                            className="bg-background rounded-full border px-3 py-1.5 text-xs font-medium"
                          >
                            <Clock3 className="mr-1.5 inline h-3.5 w-3.5 text-emerald-600" />
                            {timeLabel(startTime)}–{timeLabel(endTime)}
                            {staffName ? ` · ${staffName}` : ''}
                          </span>
                        )
                      })}
                    </div>
                  )}

                  <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/[0.045] p-4">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="text-sm font-bold">
                          Exact customer message
                        </p>
                        <p className="text-muted-foreground mt-1 text-xs">
                          Personalization is rule-based. No AI decides who
                          receives it.
                        </p>
                      </div>
                      <Badge variant="outline">
                        {selectedCampaign.offer_code}
                      </Badge>
                    </div>
                    <div className="mt-4 max-w-xl rounded-2xl rounded-bl-md bg-emerald-600 p-4 text-sm leading-6 text-white shadow-sm">
                      {selectedCampaign.message_template
                        .replaceAll('{{first_name}}', 'David')
                        .replaceAll(
                          '{{zip_code}}',
                          selectedCampaign.selected_zips[0] || '80918',
                        )
                        .replaceAll(
                          '{{offer_amount}}',
                          String(selectedCampaign.offer_amount),
                        )
                        .replaceAll(
                          '{{minimum_subtotal}}',
                          String(selectedCampaign.minimum_subtotal),
                        )
                        .replaceAll(
                          '{{offer_code}}',
                          selectedCampaign.offer_code,
                        )
                        .replaceAll(
                          '{{booking_url}}',
                          'sightings.sasquatchcarpet.com/fill/••••',
                        )}
                    </div>
                  </div>

                  <div className="flex flex-col gap-3 rounded-2xl border p-4 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="font-bold">
                        {remaining} eligible customers remain
                      </p>
                      <p className="text-muted-foreground mt-1 text-xs">
                        Sending is capped at the wave size you approve. Every
                        customer is rechecked immediately before send.
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {([5, 10, 15] as const)
                        .filter((amount) => amount <= safeWaveLimit)
                        .map((amount) => (
                          <Button
                            key={amount}
                            size="sm"
                            variant={
                              amount === draft.default_wave_size
                                ? 'default'
                                : 'outline'
                            }
                            disabled={
                              !draft.send_enabled ||
                              remaining === 0 ||
                              ['filled', 'skipped', 'failed'].includes(
                                selectedCampaign.status,
                              )
                            }
                            onClick={() => setReviewAmount(amount)}
                          >
                            <Send className="mr-1.5 h-3.5 w-3.5" />
                            Send {amount}
                          </Button>
                        ))}
                    </div>
                  </div>
                  {!draft.send_enabled && (
                    <p className="flex items-center gap-2 rounded-xl bg-amber-500/10 px-4 py-3 text-sm font-medium text-amber-800 dark:text-amber-300">
                      <PauseCircle className="h-4 w-4" /> Preview Only is
                      protecting this campaign. Enable live sending in Settings
                      when you are ready.
                    </p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="border-border/60 shadow-sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Users className="h-5 w-5 text-emerald-600" /> Ranked audience
              </CardTitle>
              <p className="text-muted-foreground text-sm">
                Oldest eligible clean first, then customer value. Exact ZIP and
                phone/household deduplication are already applied.
              </p>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] text-sm">
                  <thead className="bg-muted/30 text-muted-foreground border-y text-left text-xs tracking-wide uppercase">
                    <tr>
                      <th className="px-5 py-3">Rank</th>
                      <th className="px-3 py-3">Customer</th>
                      <th className="px-3 py-3">ZIP</th>
                      <th className="px-3 py-3">Latest recorded clean</th>
                      <th className="px-3 py-3">LTV</th>
                      <th className="px-3 py-3">Funnel</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {data.recipients.map((recipient) => {
                      const customer = relationOne(recipient.ops_customers)
                      return (
                        <tr key={recipient.id} className="hover:bg-muted/20">
                          <td className="text-muted-foreground px-5 py-3 font-mono text-xs">
                            #{recipient.rank}
                          </td>
                          <td className="px-3 py-3">
                            <p className="font-semibold">
                              {customer?.full_name || 'Customer'}
                            </p>
                            <p className="text-muted-foreground text-xs">
                              {recipient.phone_normalized}
                            </p>
                          </td>
                          <td className="px-3 py-3 font-medium">
                            {recipient.zip_code}
                          </td>
                          <td className="px-3 py-3">
                            {dateLabel(recipient.last_clean_date)}
                          </td>
                          <td className="px-3 py-3">
                            {money(recipient.lifetime_value)}
                          </td>
                          <td className="px-3 py-3">
                            <span
                              className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase ${statusTone(recipient.status)}`}
                            >
                              {recipient.status}
                            </span>
                            {recipient.exclusion_reason && (
                              <p className="mt-1 max-w-40 text-xs text-red-600">
                                {recipient.exclusion_reason}
                              </p>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              {data.recipients.length === 0 && (
                <div className="text-muted-foreground p-8 text-center text-sm">
                  No eligible customers were stored for this campaign.
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <aside className="min-w-0 space-y-6">
          <Card className="border-border/60 shadow-sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Settings2 className="h-5 w-5 text-emerald-600" /> Decision
                settings
              </CardTitle>
              <p className="text-muted-foreground text-sm">
                Every factor that decides eligibility lives here.
              </p>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="flex items-center justify-between rounded-xl border p-4">
                <div>
                  <p className="font-semibold">Daily scan</p>
                  <p className="text-muted-foreground text-xs">
                    9:00 AM Mountain, day before
                  </p>
                </div>
                <Switch
                  label="Daily scan"
                  checked={draft.engine_enabled}
                  onChange={(value) => setSetting('engine_enabled', value)}
                />
              </div>
              <div
                className={`flex items-center justify-between rounded-xl border p-4 ${draft.send_enabled ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-amber-500/30 bg-amber-500/5'}`}
              >
                <div>
                  <p className="font-semibold">Live SMS sending</p>
                  <p className="text-muted-foreground text-xs">
                    {draft.send_enabled
                      ? 'Approval buttons can send texts'
                      : 'Preview and scan only'}
                  </p>
                </div>
                <Switch
                  label="Live SMS sending"
                  checked={draft.send_enabled}
                  onChange={(value) => setSetting('send_enabled', value)}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                {[
                  [
                    'dormancy_months',
                    'Months since clean',
                    'Major eligibility rule',
                  ],
                  [
                    'customer_cooldown_days',
                    'Contact cooldown',
                    'Days between texts',
                  ],
                  ['unanswered_limit', 'No-reply limit', 'Then customer rests'],
                  ['rest_days', 'Rest period', 'Days after limit'],
                  [
                    'minimum_audience_size',
                    'Minimum audience',
                    'Skip tiny routes',
                  ],
                  ['default_wave_size', 'Default wave', 'Suggested send size'],
                  ['max_discounted_bookings', 'Booking cap', 'Stops the offer'],
                  ['offer_valid_days', 'Offer life', 'Days before expiry'],
                ].map(([key, label, help]) => (
                  <div key={key}>
                    <Label htmlFor={key} className="text-xs">
                      {label}
                    </Label>
                    <Input
                      id={key}
                      type="number"
                      min={1}
                      value={String(draft[key as keyof Settings])}
                      onChange={(event) =>
                        setSetting(
                          key as keyof Settings,
                          Number(event.target.value) as never,
                        )
                      }
                      className="mt-1"
                    />
                    <p className="text-muted-foreground mt-1 text-[10px]">
                      {help}
                    </p>
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Discount</Label>
                  <Input
                    type="number"
                    value={draft.offer_amount}
                    onChange={(event) =>
                      setSetting('offer_amount', Number(event.target.value))
                    }
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label className="text-xs">Minimum subtotal</Label>
                  <Input
                    type="number"
                    value={draft.minimum_subtotal}
                    onChange={(event) =>
                      setSetting('minimum_subtotal', Number(event.target.value))
                    }
                    className="mt-1"
                  />
                </div>
              </div>
              <div>
                <Label htmlFor="fill-message" className="text-xs">
                  Message template
                </Label>
                <Textarea
                  id="fill-message"
                  rows={7}
                  value={draft.message_template}
                  onChange={(event) =>
                    setSetting('message_template', event.target.value)
                  }
                  className="mt-1 text-sm leading-6"
                />
                <p className="text-muted-foreground mt-1 text-[10px]">
                  Required link: {'{{booking_url}}'} · Available: first_name,
                  zip_code, offer_amount, minimum_subtotal, offer_code.
                </p>
              </div>
              <div className="bg-muted/20 text-muted-foreground rounded-xl border p-4 text-xs leading-5">
                <p className="text-foreground font-bold">Fixed safeguards</p>
                <ul className="mt-2 space-y-1">
                  <li>• Exact five-digit route ZIP match</li>
                  <li>• Residential completed clean only</li>
                  <li>• Restoration always excluded</li>
                  <li>• Future bookings, DNC, blacklist, STOP excluded</li>
                  <li>• One customer per phone and household</li>
                </ul>
              </div>
              <Button
                className="w-full"
                disabled={working === 'save'}
                onClick={() =>
                  void mutate(
                    draft as unknown as Record<string, unknown>,
                    'Tomorrow Fill settings were saved.',
                  )
                }
              >
                <Save className="mr-2 h-4 w-4" /> Save controls
              </Button>
            </CardContent>
          </Card>

          <Card className="border-border/60 shadow-sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Activity className="h-5 w-5 text-emerald-600" /> Funnel & audit
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-3 gap-2">
                {[
                  [selectedCampaign?.sent_count || 0, 'Delivered'],
                  [clicked, 'Clicked'],
                  [replied, 'Replied'],
                ].map(([value, label]) => (
                  <div
                    key={String(label)}
                    className="bg-muted/40 rounded-xl p-3 text-center"
                  >
                    <p className="text-xl font-black">{value}</p>
                    <p className="text-muted-foreground text-[10px]">{label}</p>
                  </div>
                ))}
              </div>
              <div className="mt-5 space-y-4">
                {data.events.slice(0, 8).map((event) => (
                  <div key={event.id} className="flex gap-3">
                    <div className="mt-1 h-2 w-2 shrink-0 rounded-full bg-emerald-500" />
                    <div>
                      <p className="text-sm font-semibold">
                        {event.event_type.replaceAll('_', ' ')}
                      </p>
                      <p className="text-muted-foreground text-xs">
                        {new Date(event.created_at).toLocaleString()} ·{' '}
                        {event.actor || 'system'}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </aside>
      </div>

      {reviewAmount && selectedCampaign && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 backdrop-blur-sm sm:items-center sm:p-6">
          <div className="bg-background max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-t-[28px] border shadow-2xl sm:rounded-[28px]">
            <div className="bg-background/95 sticky top-0 flex items-start justify-between border-b p-5 backdrop-blur">
              <div>
                <p className="text-xs font-bold tracking-widest text-emerald-600 uppercase">
                  Final approval
                </p>
                <h2 className="mt-1 text-2xl font-black">
                  Send {reviewRecipients.length} customer texts?
                </h2>
              </div>
              <Button
                size="icon"
                variant="ghost"
                onClick={() => setReviewAmount(null)}
              >
                <X className="h-5 w-5" />
              </Button>
            </div>
            <div className="space-y-5 p-5">
              <div className="rounded-xl border border-amber-500/25 bg-amber-500/8 p-4 text-sm">
                <ShieldCheck className="mr-2 inline h-4 w-4 text-amber-600" />
                This is the exact ranked group. The server will recheck STOP,
                blacklist, and future appointments once more before sending.
              </div>
              <div className="max-h-52 divide-y overflow-y-auto rounded-xl border">
                {reviewRecipients.map((recipient) => (
                  <div
                    key={recipient.id}
                    className="flex items-center justify-between px-4 py-2.5 text-sm"
                  >
                    <span>
                      <strong>#{recipient.rank}</strong>{' '}
                      {relationOne(recipient.ops_customers)?.full_name}
                    </span>
                    <span className="text-muted-foreground">
                      {recipient.zip_code}
                    </span>
                  </div>
                ))}
              </div>
              <div className="rounded-2xl bg-emerald-600 p-4 text-sm leading-6 text-white">
                {selectedCampaign.message_template
                  .replaceAll('{{first_name}}', 'Customer name')
                  .replaceAll(
                    '{{zip_code}}',
                    selectedCampaign.selected_zips[0] || 'ZIP',
                  )
                  .replaceAll(
                    '{{offer_amount}}',
                    String(selectedCampaign.offer_amount),
                  )
                  .replaceAll(
                    '{{minimum_subtotal}}',
                    String(selectedCampaign.minimum_subtotal),
                  )
                  .replaceAll('{{offer_code}}', selectedCampaign.offer_code)
                  .replaceAll('{{booking_url}}', 'private booking link')}
              </div>
              <div className="flex gap-3">
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={() => setReviewAmount(null)}
                >
                  Cancel
                </Button>
                <Button
                  className="flex-1 bg-emerald-600 hover:bg-emerald-500"
                  disabled={working === 'send'}
                  onClick={() =>
                    void mutate(
                      {
                        action: 'send',
                        campaign_id: selectedCampaign.id,
                        amount: reviewAmount,
                      },
                      `The approved ${reviewAmount} customer wave was processed.`,
                    )
                  }
                >
                  <CheckCircle2 className="mr-2 h-4 w-4" />
                  Confirm send
                </Button>
              </div>
              <button
                className="text-muted-foreground hover:text-foreground flex w-full items-center justify-center gap-1 text-xs"
                onClick={() =>
                  void mutate(
                    { action: 'skip', campaign_id: selectedCampaign.id },
                    'Tomorrow’s campaign was skipped.',
                  )
                }
              >
                <ChevronRight className="h-3 w-3" />
                Skip this route instead
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
