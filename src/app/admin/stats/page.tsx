'use client'

import { useEffect, useState } from 'react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { createClient } from '@/supabase/client'
import {
  Loader2,
  DollarSign,
  Clock,
  TrendingUp,
  TrendingDown,
  Target,
  Briefcase,
  Plus,
  Settings as SettingsIcon,
  Rocket,
  CalendarCheck,
  CalendarDays,
} from 'lucide-react'

type OpsStats = {
  weekStart: string
  weekEnd: string
  jobCount: number
  invoicedJobCount: number
  totalRevenue: number
  averageTicket: number
  statusCounts: Record<string, number>
  paymentStatusCounts: Record<string, number>
  leadSourceCounts: Record<string, number>
}

type CalendarPipelineMonth = {
  month: number
  label: string
  completedRevenue: number
  completedJobCount: number
  bookedRevenue: number
  bookedJobCount: number
}

type CalendarPipeline = {
  year: number
  currentMonth: number
  totalCompleted: number
  totalBooked: number
  months: CalendarPipelineMonth[]
}

type Settings = {
  annual_revenue_goal: number
  available_hours_per_week: number
  work_weeks_per_year: number
  hiring_threshold: number
  hiring_consecutive_weeks: number
}

type Stats = {
  thisWeek: {
    jobs: number
    revenue: number
    hours: number
    revenuePerHour: number
    averageTicket: number
  }
  yearToDate: {
    jobs: number
    revenue: number
    hours: number
    revenuePerHour: number
    utilization: number
    availableHours: number
  }
  pace: {
    weeklyTarget: number
    weeklyAverage: number
    projectedAnnual: number
    onPace: boolean
    percentOfGoal: number
  }
  potential: {
    revenueAtFullUtilizationYTD: number
    revenueLeftOnTableYTD: number
    annualRevenueAtFullUtilization: number
    annualRevenueLeftOnTable: number
    totalAvailableHoursAnnual: number
    scheduleBased: boolean
    currentWeeklyCapacity: number | null
  }
}

type ScheduleCapacity = {
  ytdAvailableHours: number
  annualAvailableHours: number
  currentWeeklyCapacity: number
  lastToggleDate: string | null
}

export default function StatsPage() {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [stats, setStats] = useState<Stats | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [opsStats, setOpsStats] = useState<OpsStats | null>(null)
  const [opsLoading, setOpsLoading] = useState(true)
  const [pipeline, setPipeline] = useState<CalendarPipeline | null>(null)
  const [pipelineLoading, setPipelineLoading] = useState(true)

  // Quick entry form state
  const [showQuickEntry, setShowQuickEntry] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [entryDate, setEntryDate] = useState(
    new Date().toISOString().split('T')[0],
  )
  const [description, setDescription] = useState('')
  const [invoiceAmount, setInvoiceAmount] = useState('')
  const [hoursWorked, setHoursWorked] = useState('')
  const [submitError, setSubmitError] = useState<string | null>(null)

  // Settings editor state
  const [showSettingsEditor, setShowSettingsEditor] = useState(false)
  const [isSavingSettings, setIsSavingSettings] = useState(false)
  const [settingsError, setSettingsError] = useState<string | null>(null)
  const [editAnnualGoal, setEditAnnualGoal] = useState('')
  const [editHoursPerWeek, setEditHoursPerWeek] = useState('')
  const [editWeeksPerYear, setEditWeeksPerYear] = useState('')
  const [editHiringThreshold, setEditHiringThreshold] = useState('')
  const [editHiringConsecutiveWeeks, setEditHiringConsecutiveWeeks] =
    useState('')

  const handleQuickEntry = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsSubmitting(true)
    setSubmitError(null)

    try {
      const response = await fetch('/api/revenue-entries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          entry_date: entryDate,
          description,
          invoice_amount: parseFloat(invoiceAmount),
          hours_worked: parseFloat(hoursWorked),
        }),
      })

      if (!response.ok) {
        throw new Error('Failed to create entry')
      }

      // Reset form
      setDescription('')
      setInvoiceAmount('')
      setHoursWorked('')
      setEntryDate(new Date().toISOString().split('T')[0])
      setShowQuickEntry(false)

      // Refresh data
      fetchData()
    } catch (err) {
      setSubmitError(
        err instanceof Error ? err.message : 'Failed to save entry',
      )
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsSavingSettings(true)
    setSettingsError(null)

    try {
      const supabase = createClient()
      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (!user) throw new Error('Not authenticated')

      const newSettings = {
        annual_revenue_goal: parseFloat(editAnnualGoal),
        available_hours_per_week: parseFloat(editHoursPerWeek),
        work_weeks_per_year: parseInt(editWeeksPerYear),
        hiring_threshold: parseFloat(editHiringThreshold),
        hiring_consecutive_weeks: parseInt(editHiringConsecutiveWeeks),
        updated_at: new Date().toISOString(),
      }

      // Check if settings exist for this user
      const { data: existingSettings } = await supabase
        .from('settings')
        .select('id')
        .eq('user_id', user.id)
        .single()

      if (existingSettings) {
        // Update existing settings
        const { error: updateError } = await supabase
          .from('settings')
          .update(newSettings)
          .eq('user_id', user.id)

        if (updateError) throw updateError
      } else {
        // Insert new settings
        const { error: insertError } = await supabase
          .from('settings')
          .insert({ ...newSettings, user_id: user.id })

        if (insertError) throw insertError
      }

      setShowSettingsEditor(false)
      fetchData() // Refresh all stats with new settings
    } catch (err) {
      setSettingsError(
        err instanceof Error ? err.message : 'Failed to save settings',
      )
    } finally {
      setIsSavingSettings(false)
    }
  }

  const openSettingsEditor = () => {
    if (settings) {
      setEditAnnualGoal(settings.annual_revenue_goal.toString())
      setEditHoursPerWeek(settings.available_hours_per_week.toString())
      setEditWeeksPerYear(settings.work_weeks_per_year.toString())
      setEditHiringThreshold((settings.hiring_threshold || 4000).toString())
      setEditHiringConsecutiveWeeks(
        (settings.hiring_consecutive_weeks || 4).toString(),
      )
    }
    setShowSettingsEditor(true)
  }

  async function fetchData() {
    try {
      const supabase = createClient()

      // Fetch user settings (or create default)
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user) throw new Error('Not authenticated')

      let { data: userSettings } = await supabase
        .from('settings')
        .select('*')
        .eq('user_id', user.id)
        .single()

      // If no settings exist, use defaults
      if (!userSettings) {
        userSettings = {
          annual_revenue_goal: 150000,
          available_hours_per_week: 40,
          work_weeks_per_year: 48,
          hiring_threshold: 4000,
          hiring_consecutive_weeks: 4,
        }
      } else {
        // Ensure hiring settings have defaults
        userSettings.hiring_threshold = userSettings.hiring_threshold || 4000
        userSettings.hiring_consecutive_weeks =
          userSettings.hiring_consecutive_weeks || 4
      }

      setSettings(userSettings)

      // Fetch jobs data
      const { data: jobs, error: jobsError } = await supabase
        .from('jobs')
        .select('invoice_amount, hours_worked, created_at')
        .not('invoice_amount', 'is', null)
        .not('hours_worked', 'is', null)
        .order('created_at', { ascending: false })

      if (jobsError) throw jobsError

      // Fetch revenue entries (drive_minutes adds to utilization hours from on-my-way)
      const { data: entries, error: entriesError } = await supabase
        .from('revenue_entries')
        .select('invoice_amount, hours_worked, entry_date, drive_minutes')
        .eq('user_id', user.id)
        .order('entry_date', { ascending: false })

      if (entriesError) throw entriesError

      let supplementRows: {
        invoice_amount: number
        hours_worked: number
        date: string
      }[] = []
      let scheduleCapacity: ScheduleCapacity | null = null
      const [supRes, capRes] = await Promise.allSettled([
        fetch('/api/admin/stats/utilization-supplement', {
          cache: 'no-store',
        }),
        fetch('/api/admin/stats/capacity', { cache: 'no-store' }),
      ])
      if (supRes.status === 'fulfilled' && supRes.value.ok) {
        try {
          const supJson = (await supRes.value.json()) as {
            rows?: typeof supplementRows
          }
          supplementRows = supJson.rows || []
        } catch {
          /* non-fatal */
        }
      }
      if (capRes.status === 'fulfilled' && capRes.value.ok) {
        try {
          const capJson = (await capRes.value.json()) as {
            capacity?: ScheduleCapacity | null
          }
          scheduleCapacity = capJson.capacity || null
        } catch {
          /* non-fatal */
        }
      }

      // Combine jobs, manual/quick entries, and completed ops not yet in jobs/revenue_entries
      const allRevenue = [
        ...(jobs || []).map((j) => ({ ...j, date: j.created_at })),
        ...(entries || []).map((e) => ({
          ...e,
          // Append T00:00:00 (no Z) so bare date strings are parsed as local
          // time rather than UTC midnight, which would shift them to the prior
          // day in US timezones and break week/YTD bucketing.
          date: e.entry_date + 'T00:00:00',
          hours_worked: (e.hours_worked || 0) + (e.drive_minutes || 0) / 60,
        })),
        ...supplementRows.map((r) => ({
          invoice_amount: r.invoice_amount,
          hours_worked: r.hours_worked,
          date: r.date,
        })),
      ]

      // Calculate stats
      const now = new Date()
      // Same week as "Live Jobs" (Mon–Sun) and /api/admin/ops/stats
      const getMonday = (d: Date) => {
        const date = new Date(d)
        const day = date.getDay()
        const diff = date.getDate() - day + (day === 0 ? -6 : 1)
        date.setDate(diff)
        date.setHours(0, 0, 0, 0)
        return date
      }
      const mondayWeekStart = getMonday(now)
      const nextMonday = new Date(mondayWeekStart)
      nextMonday.setDate(nextMonday.getDate() + 7)

      const startOfYear = new Date(now.getFullYear(), 0, 1)

      // Filter by date (calendar week Mon–Sun)
      const thisWeekData = allRevenue.filter((item) => {
        const itemDate = new Date(item.date)
        return itemDate >= mondayWeekStart && itemDate < nextMonday
      })
      const ytdData = allRevenue.filter(
        (item) => new Date(item.date) >= startOfYear,
      )

      // This Week
      const thisWeekRevenue = thisWeekData.reduce(
        (sum, item) => sum + (item.invoice_amount || 0),
        0,
      )
      const thisWeekHours = thisWeekData.reduce(
        (sum, item) => sum + (item.hours_worked || 0),
        0,
      )

      // Year to Date
      const ytdRevenue = ytdData.reduce(
        (sum, item) => sum + (item.invoice_amount || 0),
        0,
      )
      const ytdHours = ytdData.reduce(
        (sum, item) => sum + (item.hours_worked || 0),
        0,
      )

      // Calculations — capacity comes from the live tech schedule when
      // available (every tech's open days), else the flat settings fallback.
      const weeksElapsed = Math.max(
        (now.getTime() - startOfYear.getTime()) / (7 * 24 * 60 * 60 * 1000),
        1,
      )
      const availableHoursYTD =
        scheduleCapacity?.ytdAvailableHours ??
        Math.ceil(weeksElapsed) * userSettings.available_hours_per_week
      const utilization =
        availableHoursYTD > 0 ? (ytdHours / availableHoursYTD) * 100 : 0

      const weeklyTarget =
        userSettings.annual_revenue_goal / userSettings.work_weeks_per_year
      const weeklyAverage = ytdRevenue / weeksElapsed
      const projectedAnnual = weeklyAverage * userSettings.work_weeks_per_year
      const onPace = projectedAnnual >= userSettings.annual_revenue_goal
      const percentOfGoal =
        (ytdRevenue / userSettings.annual_revenue_goal) * 100

      // Potential revenue calculations
      const revenuePerHour = ytdHours > 0 ? ytdRevenue / ytdHours : 0
      const totalAvailableHoursAnnual =
        scheduleCapacity?.annualAvailableHours ??
        userSettings.available_hours_per_week * userSettings.work_weeks_per_year
      const revenueAtFullUtilizationYTD = revenuePerHour * availableHoursYTD
      const revenueLeftOnTableYTD = revenueAtFullUtilizationYTD - ytdRevenue
      const annualRevenueAtFullUtilization =
        revenuePerHour * totalAvailableHoursAnnual
      const annualRevenueLeftOnTable =
        annualRevenueAtFullUtilization - projectedAnnual

      setStats({
        thisWeek: {
          jobs: thisWeekData.length,
          revenue: thisWeekRevenue,
          hours: thisWeekHours,
          revenuePerHour:
            thisWeekHours > 0 ? thisWeekRevenue / thisWeekHours : 0,
          averageTicket:
            thisWeekData.length > 0 ? thisWeekRevenue / thisWeekData.length : 0,
        },
        yearToDate: {
          jobs: ytdData.length,
          revenue: ytdRevenue,
          hours: ytdHours,
          revenuePerHour: ytdHours > 0 ? ytdRevenue / ytdHours : 0,
          utilization,
          availableHours: availableHoursYTD,
        },
        pace: {
          weeklyTarget,
          weeklyAverage,
          projectedAnnual,
          onPace,
          percentOfGoal,
        },
        potential: {
          revenueAtFullUtilizationYTD,
          revenueLeftOnTableYTD,
          annualRevenueAtFullUtilization,
          annualRevenueLeftOnTable,
          totalAvailableHoursAnnual,
          scheduleBased: !!scheduleCapacity,
          currentWeeklyCapacity:
            scheduleCapacity?.currentWeeklyCapacity ?? null,
        },
      })
    } catch (err) {
      console.error('Error fetching stats:', err)
      setError(err instanceof Error ? err.message : 'Failed to load stats')
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    fetchData()
  }, [])

  useEffect(() => {
    async function fetchOpsStats() {
      setOpsLoading(true)
      try {
        const response = await fetch('/api/admin/ops/stats', {
          cache: 'no-store',
        })
        const result = await response.json()
        if (!response.ok) throw new Error(result.error || 'Failed to load')
        setOpsStats(result)
      } catch {
        // Non-fatal — existing stats still show
      } finally {
        setOpsLoading(false)
      }
    }
    void fetchOpsStats()
  }, [])

  useEffect(() => {
    async function fetchPipeline() {
      setPipelineLoading(true)
      try {
        const res = await fetch('/api/admin/ops/calendar-pipeline', {
          cache: 'no-store',
        })
        if (res.ok) setPipeline(await res.json())
      } catch {
        // Non-fatal
      } finally {
        setPipelineLoading(false)
      }
    }
    void fetchPipeline()
  }, [])

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="bg-destructive/10 text-destructive rounded-md p-4">
          {error}
        </div>
      </div>
    )
  }

  if (!stats || !settings) return null

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount)
  }

  return (
    <div className="container mx-auto max-w-6xl px-4 py-8">
      <div className="mb-8">
        {/* Mobile: buttons first, title below. Desktop: side by side */}
        <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div className="order-2 md:order-1">
            <h1 className="text-gradient text-3xl font-bold tracking-tight md:text-4xl">
              Statistics
            </h1>
            <p className="text-muted-foreground mt-1 text-sm md:mt-2 md:text-base">
              Revenue, efficiency, pipeline, and progress toward your annual
              goal
            </p>
          </div>
          <div className="order-1 flex shrink-0 gap-2 md:order-2">
            <Button
              onClick={() => setShowQuickEntry(!showQuickEntry)}
              variant="default"
              size="sm"
            >
              <Plus className="mr-1 h-4 w-4" />
              Quick Entry
            </Button>
            <Button onClick={openSettingsEditor} variant="outline" size="sm">
              <SettingsIcon className="mr-1 h-4 w-4" />
              Goals
            </Button>
          </div>
        </div>

        {/* Settings Editor Form */}
        {showSettingsEditor && (
          <Card className="mb-6 p-6">
            <h3 className="mb-4 text-lg font-semibold">Edit Goals</h3>
            <p className="text-muted-foreground mb-4 text-sm">
              Update your annual revenue goal and availability settings
            </p>
            <form onSubmit={handleSaveSettings} className="space-y-4">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <div>
                  <Label htmlFor="editAnnualGoal">
                    Annual Revenue Goal ($)
                  </Label>
                  <Input
                    id="editAnnualGoal"
                    type="number"
                    step="1000"
                    value={editAnnualGoal}
                    onChange={(e) => setEditAnnualGoal(e.target.value)}
                    placeholder="150000"
                    required
                  />
                </div>
                <div>
                  <Label htmlFor="editHoursPerWeek">Available Hours/Week</Label>
                  <Input
                    id="editHoursPerWeek"
                    type="number"
                    step="1"
                    value={editHoursPerWeek}
                    onChange={(e) => setEditHoursPerWeek(e.target.value)}
                    placeholder="40"
                    required
                  />
                  <p className="text-muted-foreground mt-1 text-xs">
                    Fallback only — capacity normally comes from the tech
                    schedule
                  </p>
                </div>
                <div>
                  <Label htmlFor="editWeeksPerYear">Work Weeks/Year</Label>
                  <Input
                    id="editWeeksPerYear"
                    type="number"
                    step="1"
                    value={editWeeksPerYear}
                    onChange={(e) => setEditWeeksPerYear(e.target.value)}
                    placeholder="48"
                    required
                  />
                </div>
              </div>

              {/* Hiring Readiness Settings */}
              <div className="border-t pt-4">
                <h4 className="mb-3 flex items-center gap-2 text-sm font-medium">
                  <Rocket className="h-4 w-4" />
                  Hiring Readiness Settings
                </h4>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div>
                    <Label htmlFor="editHiringThreshold">
                      Weekly Threshold ($)
                    </Label>
                    <Input
                      id="editHiringThreshold"
                      type="number"
                      step="100"
                      value={editHiringThreshold}
                      onChange={(e) => setEditHiringThreshold(e.target.value)}
                      placeholder="4000"
                      required
                    />
                    <p className="text-muted-foreground mt-1 text-xs">
                      Weekly revenue target to trigger hiring signal
                    </p>
                  </div>
                  <div>
                    <Label htmlFor="editHiringConsecutiveWeeks">
                      Consecutive Weeks
                    </Label>
                    <Input
                      id="editHiringConsecutiveWeeks"
                      type="number"
                      step="1"
                      min="1"
                      max="12"
                      value={editHiringConsecutiveWeeks}
                      onChange={(e) =>
                        setEditHiringConsecutiveWeeks(e.target.value)
                      }
                      placeholder="4"
                      required
                    />
                    <p className="text-muted-foreground mt-1 text-xs">
                      Weeks at threshold before hiring signal
                    </p>
                  </div>
                </div>
              </div>
              {settingsError && (
                <div className="text-destructive text-sm">{settingsError}</div>
              )}
              <div className="flex gap-2">
                <Button type="submit" disabled={isSavingSettings}>
                  {isSavingSettings ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    'Save Goals'
                  )}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setShowSettingsEditor(false)}
                >
                  Cancel
                </Button>
              </div>
            </form>
          </Card>
        )}

        {/* Quick Entry Form */}
        {showQuickEntry && (
          <Card className="mb-6 p-6">
            <h3 className="mb-4 text-lg font-semibold">Add Revenue Entry</h3>
            <p className="text-muted-foreground mb-4 text-sm">
              Track commercial work or recurring jobs without creating a public
              post
            </p>
            <form onSubmit={handleQuickEntry} className="space-y-4">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <div>
                  <Label htmlFor="entryDate">Date</Label>
                  <Input
                    id="entryDate"
                    type="date"
                    value={entryDate}
                    onChange={(e) => setEntryDate(e.target.value)}
                    required
                  />
                </div>
                <div>
                  <Label htmlFor="invoiceAmount">Invoice Amount</Label>
                  <Input
                    id="invoiceAmount"
                    type="number"
                    step="0.01"
                    value={invoiceAmount}
                    onChange={(e) => setInvoiceAmount(e.target.value)}
                    placeholder="0.00"
                    required
                  />
                </div>
                <div>
                  <Label htmlFor="hoursWorked">Hours Worked</Label>
                  <Input
                    id="hoursWorked"
                    type="number"
                    step="0.25"
                    value={hoursWorked}
                    onChange={(e) => setHoursWorked(e.target.value)}
                    placeholder="0.0"
                    required
                  />
                </div>
              </div>
              <div>
                <Label htmlFor="description">Description</Label>
                <Textarea
                  id="description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Recovery Village - Hallways"
                  rows={2}
                  required
                />
              </div>
              {submitError && (
                <div className="text-destructive text-sm">{submitError}</div>
              )}
              <div className="flex gap-2">
                <Button type="submit" disabled={isSubmitting}>
                  {isSubmitting ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    'Save Entry'
                  )}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setShowQuickEntry(false)}
                >
                  Cancel
                </Button>
              </div>
            </form>
          </Card>
        )}
      </div>

      {/* ── Calendar Pipeline ─────────────────────────────────────────── */}
      <div className="mb-8">
        <div className="mb-1 flex items-center gap-2">
          <CalendarDays className="h-5 w-5 text-blue-400" />
          <h2 className="text-gradient-blue text-xl font-semibold tracking-tight">
            {new Date().getFullYear()} Calendar Value
          </h2>
        </div>
        <p className="text-muted-foreground mb-4 text-xs">
          Completed work in orange, still booked on the calendar in blue — all
          from the live Operations schedule. Past months show completed; the
          current month shows completed + still booked; future months show
          what&apos;s already booked.
        </p>

        {isLoading ? (
          <div className="text-muted-foreground flex items-center gap-2 text-sm">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading calendar data...
          </div>
        ) : (
          (() => {
            const now = new Date()
            const currentMonth = now.getMonth() + 1
            const totalActual = pipeline?.totalCompleted ?? 0
            const totalBooked = pipeline?.totalBooked ?? 0
            const totalOnCalendar = totalActual + totalBooked
            const LABELS = [
              'Jan',
              'Feb',
              'Mar',
              'Apr',
              'May',
              'Jun',
              'Jul',
              'Aug',
              'Sep',
              'Oct',
              'Nov',
              'Dec',
            ]
            const allMonthValues = LABELS.map((_, i) => {
              const month = i + 1
              const completed = pipeline?.months[i]?.completedRevenue ?? 0
              const booked = pipeline?.months[i]?.bookedRevenue ?? 0
              if (month < currentMonth) return completed
              if (month === currentMonth) return completed + booked
              return booked
            })
            const maxVal = Math.max(...allMonthValues, 1)

            return (
              <div className="space-y-4">
                {/* Summary cards */}
                <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                  <Card className="card-interactive animate-slide-up border-blue-500/30 bg-blue-950/30 p-4 backdrop-blur">
                    <p className="mb-1 text-sm font-medium tracking-wide text-blue-300/80 uppercase">
                      Full Year Value
                    </p>
                    <p className="stat-value stat-glow-blue text-3xl font-bold text-blue-300">
                      {formatCurrency(totalOnCalendar)}
                    </p>
                    <p className="text-muted-foreground mt-1 text-xs">
                      completed + scheduled
                    </p>
                  </Card>
                  <Card className="card-interactive animate-slide-up-delay-1 border-border/60 bg-card/80 p-4 backdrop-blur">
                    <p className="mb-1 text-sm font-medium tracking-wide text-orange-300/80 uppercase">
                      Completed
                    </p>
                    <p className="stat-value stat-glow-amber text-3xl font-bold text-orange-400">
                      {formatCurrency(totalActual)}
                    </p>
                    <p className="text-muted-foreground mt-1 text-xs">
                      work done this year
                    </p>
                  </Card>
                  <Card className="card-interactive animate-slide-up-delay-2 border-border/60 bg-card/80 p-4 backdrop-blur">
                    <p className="mb-1 text-sm font-medium tracking-wide text-blue-300/80 uppercase">
                      Scheduled
                    </p>
                    <p className="stat-value stat-glow-blue text-3xl font-bold text-blue-400">
                      {formatCurrency(totalBooked)}
                    </p>
                    <p className="text-muted-foreground mt-1 text-xs">
                      still booked on the calendar
                    </p>
                  </Card>
                </div>

                {/* Monthly chart */}
                <Card className="border-border/60 bg-card/80 p-5 backdrop-blur">
                  <h3 className="mb-1 text-sm font-semibold">Month by Month</h3>
                  <p className="text-muted-foreground mb-4 text-xs">
                    <span className="inline-block h-2 w-3 rounded-sm bg-slate-400/60 align-middle" />{' '}
                    Collected&nbsp;&nbsp;
                    <span className="inline-block h-2 w-3 rounded-sm bg-orange-400/80 align-middle" />{' '}
                    Done this month&nbsp;&nbsp;
                    <span className="inline-block h-2 w-3 rounded-sm bg-blue-400/60 align-middle" />{' '}
                    Booked ahead
                  </p>
                  <div className="space-y-2">
                    {LABELS.map((_, i) => {
                      const month = i + 1
                      const label = LABELS[i]
                      const completed =
                        pipeline?.months[i]?.completedRevenue ?? 0
                      const booked = pipeline?.months[i]?.bookedRevenue ?? 0
                      const total = completed + booked
                      const isCurrent = month === currentMonth
                      const completedPct = Math.round(
                        (completed / maxVal) * 100,
                      )
                      const bookedPct = Math.round((booked / maxVal) * 100)
                      // Past months = slate (collected); current = orange (done now)
                      const completedColor = isCurrent
                        ? 'bg-orange-400/80'
                        : 'bg-slate-400/60'
                      return (
                        <div key={month} className="flex items-center gap-3">
                          <span
                            className={`w-9 shrink-0 text-right text-xs ${
                              isCurrent
                                ? 'font-bold text-blue-600 dark:text-blue-400'
                                : 'text-muted-foreground font-medium'
                            }`}
                          >
                            {label}
                            {isCurrent && (
                              <span className="ml-0.5 text-[9px]">▶</span>
                            )}
                          </span>
                          <div className="relative h-5 flex-1 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                            {completed > 0 && (
                              <div
                                className={`absolute inset-y-0 left-0 flex items-center ${completedColor}`}
                                style={{
                                  width: `${completedPct}%`,
                                  borderRadius:
                                    booked > 0 ? '9999px 0 0 9999px' : '9999px',
                                }}
                              >
                                <span className="truncate pr-1 pl-2 text-[10px] font-semibold whitespace-nowrap text-white">
                                  {formatCurrency(completed)}
                                </span>
                              </div>
                            )}
                            {booked > 0 && (
                              <div
                                className="absolute inset-y-0 flex items-center bg-blue-400/70"
                                style={{
                                  left: `${completedPct}%`,
                                  width: `${bookedPct}%`,
                                  borderRadius:
                                    completed > 0
                                      ? '0 9999px 9999px 0'
                                      : '9999px',
                                }}
                              >
                                <span className="truncate pr-1 pl-2 text-[10px] font-semibold whitespace-nowrap text-white">
                                  {formatCurrency(booked)}
                                </span>
                              </div>
                            )}
                          </div>
                          <div className="w-24 shrink-0 text-right">
                            {total > 0 ? (
                              <span className="text-sm font-semibold">
                                {formatCurrency(total)}
                              </span>
                            ) : (
                              <span className="text-muted-foreground text-xs">
                                —
                              </span>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </Card>
              </div>
            )
          })()
        )}
      </div>

      {/* Live Ops Stats — from ops_appointments + ops_invoices */}
      <div className="mb-8">
        <div className="mb-4 flex items-center gap-2">
          <CalendarCheck className="h-5 w-5 text-emerald-400" />
          <h2 className="text-gradient text-xl font-semibold tracking-tight">
            This Week — Live Jobs
          </h2>
          {opsStats ? (
            <span className="text-muted-foreground text-xs">
              ({opsStats.weekStart} – {opsStats.weekEnd})
            </span>
          ) : null}
        </div>

        {opsLoading ? (
          <div className="text-muted-foreground flex items-center gap-2 text-sm">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading live job data...
          </div>
        ) : opsStats ? (
          <div className="space-y-4">
            {/* Top stat cards */}
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
              <Card className="card-interactive animate-slide-up border-border/60 bg-card/80 p-4 backdrop-blur">
                <div className="mb-1 flex items-center gap-2 text-emerald-400/80">
                  <Briefcase className="h-4 w-4" />
                  <p className="text-sm font-medium">Jobs Booked</p>
                </div>
                <p className="stat-value text-2xl font-bold text-emerald-400">
                  {opsStats.jobCount}
                </p>
              </Card>

              <Card className="card-interactive animate-slide-up-delay-1 border-border/60 bg-card/80 p-4 backdrop-blur">
                <div className="mb-1 flex items-center gap-2 text-cyan-400/80">
                  <DollarSign className="h-4 w-4" />
                  <p className="text-sm font-medium">Total Invoiced</p>
                </div>
                <p className="stat-value stat-glow-emerald text-2xl font-bold text-cyan-300">
                  {formatCurrency(opsStats.totalRevenue)}
                </p>
              </Card>

              <Card className="card-interactive animate-slide-up-delay-2 border-border/60 bg-card/80 p-4 backdrop-blur">
                <div className="mb-1 flex items-center gap-2 text-purple-400/80">
                  <TrendingUp className="h-4 w-4" />
                  <p className="text-sm font-medium">Avg Ticket</p>
                </div>
                <p className="stat-value text-2xl font-bold text-purple-300">
                  {formatCurrency(opsStats.averageTicket)}
                </p>
              </Card>

              <Card className="card-interactive animate-slide-up-delay-3 border-border/60 bg-card/80 p-4 backdrop-blur">
                <div className="mb-1 flex items-center gap-2 text-amber-400/80">
                  <Target className="h-4 w-4" />
                  <p className="text-sm font-medium">Unpaid</p>
                </div>
                <p className="stat-value text-2xl font-bold text-amber-300">
                  {opsStats.paymentStatusCounts['unpaid'] ?? 0}
                </p>
                <p className="text-muted-foreground mt-0.5 text-xs">
                  invoices outstanding
                </p>
              </Card>
            </div>

            {/* Job status + Lead source */}
            <div className="grid gap-4 md:grid-cols-2">
              <Card className="border-border/60 bg-card/80 p-4 backdrop-blur">
                <h3 className="mb-3 text-sm font-semibold">Job Status</h3>
                <div className="space-y-2">
                  {Object.entries(opsStats.statusCounts).length === 0 ? (
                    <p className="text-muted-foreground text-sm">
                      No jobs this week
                    </p>
                  ) : (
                    Object.entries(opsStats.statusCounts)
                      .sort((a, b) => b[1] - a[1])
                      .map(([status, count]) => {
                        const pct =
                          opsStats.jobCount > 0
                            ? Math.round((count / opsStats.jobCount) * 100)
                            : 0
                        return (
                          <div key={status} className="flex items-center gap-3">
                            <div className="w-24 shrink-0 text-sm capitalize">
                              {status.replace(/_/g, ' ')}
                            </div>
                            <div className="bg-muted h-2 flex-1 overflow-hidden rounded-full">
                              <div
                                className="h-2 rounded-full bg-green-500"
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                            <div className="w-12 shrink-0 text-right text-sm font-semibold">
                              {count}
                            </div>
                          </div>
                        )
                      })
                  )}
                </div>
              </Card>

              <Card className="border-border/60 bg-card/80 p-4 backdrop-blur">
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="text-sm font-semibold">Lead Source</h3>
                  <a
                    href="/admin/stats/lead-sources"
                    className="text-xs text-green-600 hover:text-green-700 hover:underline"
                  >
                    View Detailed Analytics →
                  </a>
                </div>
                <div className="space-y-2">
                  {Object.entries(opsStats.leadSourceCounts).length === 0 ? (
                    <p className="text-muted-foreground text-sm">
                      No lead source data yet
                    </p>
                  ) : (
                    Object.entries(opsStats.leadSourceCounts)
                      .sort((a, b) => b[1] - a[1])
                      .map(([source, count]) => {
                        const pct =
                          opsStats.jobCount > 0
                            ? Math.round((count / opsStats.jobCount) * 100)
                            : 0
                        return (
                          <div key={source} className="flex items-center gap-3">
                            <div className="w-32 shrink-0 truncate text-sm">
                              {source}
                            </div>
                            <div className="bg-muted h-2 flex-1 overflow-hidden rounded-full">
                              <div
                                className="h-2 rounded-full bg-green-500"
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                            <div className="w-12 shrink-0 text-right text-sm font-semibold">
                              {count}
                            </div>
                          </div>
                        )
                      })
                  )}
                </div>
              </Card>
            </div>
          </div>
        ) : (
          <p className="text-muted-foreground text-sm">
            Could not load live job data.
          </p>
        )}
      </div>

      {/* This Week */}
      <div className="mb-8">
        <h2 className="text-gradient-amber mb-1 text-xl font-semibold tracking-tight">
          This Week
        </h2>
        <p className="text-muted-foreground mb-4 max-w-3xl text-sm leading-relaxed">
          Revenue and hours here include published posts, manual entries,{' '}
          <strong>Finish &amp; close job</strong> on the invoice, and completed
          Operations jobs (same week as Live Jobs, Mon–Sun). You do{' '}
          <strong>not</strong> need photos or a social post for these numbers to
          update. <strong>Hours</strong> use the real duration from{' '}
          <strong>On My Way</strong> through{' '}
          <strong>Finish &amp; close job</strong> when both are recorded;
          otherwise the scheduled time window is used.
        </p>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3 lg:grid-cols-5">
          <Card className="card-interactive animate-slide-up border-border/60 bg-card/80 p-4 backdrop-blur">
            <div className="mb-1 flex items-center gap-2 text-amber-400/80">
              <Briefcase className="h-4 w-4" />
              <p className="text-sm font-medium">Jobs</p>
            </div>
            <p className="stat-value text-2xl font-bold text-amber-300">
              {stats.thisWeek.jobs}
            </p>
          </Card>

          <Card className="card-interactive animate-slide-up-delay-1 border-border/60 bg-card/80 p-4 backdrop-blur">
            <div className="mb-1 flex items-center gap-2 text-emerald-400/80">
              <DollarSign className="h-4 w-4" />
              <p className="text-sm font-medium">Revenue</p>
            </div>
            <p className="stat-value stat-glow-emerald text-2xl font-bold text-emerald-300">
              {formatCurrency(stats.thisWeek.revenue)}
            </p>
          </Card>

          <Card className="card-interactive animate-slide-up-delay-2 border-border/60 bg-card/80 p-4 backdrop-blur">
            <div className="mb-1 flex items-center gap-2 text-cyan-400/80">
              <Clock className="h-4 w-4" />
              <p className="text-sm font-medium">Hours</p>
            </div>
            <p className="stat-value text-2xl font-bold text-cyan-300">
              {stats.thisWeek.hours.toFixed(1)}
            </p>
          </Card>

          <Card className="card-interactive animate-slide-up-delay-3 border-border/60 bg-card/80 p-4 backdrop-blur">
            <div className="mb-1 flex items-center gap-2 text-purple-400/80">
              <TrendingUp className="h-4 w-4" />
              <p className="text-sm font-medium">$/Hour</p>
            </div>
            <p className="stat-value text-2xl font-bold text-purple-300">
              {formatCurrency(stats.thisWeek.revenuePerHour)}
            </p>
          </Card>

          <Card className="card-interactive animate-slide-up-delay-4 border-border/60 bg-card/80 p-4 backdrop-blur">
            <div className="mb-1 flex items-center gap-2 text-rose-400/80">
              <DollarSign className="h-4 w-4" />
              <p className="text-sm font-medium">Avg Ticket</p>
            </div>
            <p className="stat-value text-2xl font-bold text-rose-300">
              {formatCurrency(stats.thisWeek.averageTicket)}
            </p>
          </Card>
        </div>
      </div>

      {/* Year to Date */}
      <div className="mb-8">
        <h2 className="text-gradient mb-4 text-xl font-semibold tracking-tight">
          Year to Date
        </h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3 lg:grid-cols-5">
          <Card className="card-interactive animate-slide-up border-border/60 bg-card/80 p-4 backdrop-blur">
            <div className="mb-1 flex items-center gap-2 text-emerald-400/80">
              <Briefcase className="h-4 w-4" />
              <p className="text-sm font-medium">Total Jobs</p>
            </div>
            <p className="stat-value text-2xl font-bold text-emerald-300">
              {stats.yearToDate.jobs}
            </p>
          </Card>

          <Card className="card-interactive animate-slide-up-delay-1 border-border/60 bg-card/80 p-4 backdrop-blur">
            <div className="mb-1 flex items-center gap-2 text-cyan-400/80">
              <DollarSign className="h-4 w-4" />
              <p className="text-sm font-medium">Total Revenue</p>
            </div>
            <p className="stat-value stat-glow-emerald text-3xl font-bold text-emerald-300">
              {formatCurrency(stats.yearToDate.revenue)}
            </p>
          </Card>

          <Card className="card-interactive animate-slide-up-delay-2 border-border/60 bg-card/80 p-4 backdrop-blur">
            <div className="mb-1 flex items-center gap-2 text-blue-400/80">
              <Clock className="h-4 w-4" />
              <p className="text-sm font-medium">Total Hours</p>
            </div>
            <p className="stat-value text-2xl font-bold text-blue-300">
              {stats.yearToDate.hours.toFixed(1)}
            </p>
          </Card>

          <Card className="card-interactive animate-slide-up-delay-3 border-border/60 bg-card/80 p-4 backdrop-blur">
            <div className="mb-1 flex items-center gap-2 text-purple-400/80">
              <TrendingUp className="h-4 w-4" />
              <p className="text-sm font-medium">Avg $/Hour</p>
            </div>
            <p className="stat-value text-2xl font-bold text-purple-300">
              {formatCurrency(stats.yearToDate.revenuePerHour)}
            </p>
          </Card>

          <Card className="card-interactive animate-slide-up-delay-4 border-border/60 bg-card/80 p-4 backdrop-blur">
            <div className="mb-1 flex items-center gap-2 text-amber-400/80">
              <Target className="h-4 w-4" />
              <p className="text-sm font-medium">Utilization</p>
            </div>
            <p className="stat-value text-2xl font-bold text-amber-300">
              {stats.yearToDate.utilization.toFixed(1)}%
            </p>
          </Card>
        </div>
      </div>

      {/* Potential Revenue - Money Left on Table */}
      <div className="mb-8">
        <h2 className="text-gradient-rose mb-1 text-xl font-semibold tracking-tight">
          Potential at 100% Utilization
        </h2>
        <p className="text-muted-foreground mb-4 max-w-3xl text-sm leading-relaxed">
          {stats.potential.scheduleBased ? (
            <>
              Available hours come from the <strong>live tech schedule</strong>{' '}
              — techs count on their open days, and your time counts every
              scheduled day even when your toggle is off (that&apos;s booking
              routing, not time off).
              {stats.potential.currentWeeklyCapacity != null && (
                <>
                  {' '}
                  Current capacity:{' '}
                  <strong>
                    {Math.round(stats.potential.currentWeeklyCapacity)} hrs/week
                  </strong>{' '}
                  across all techs (trailing 4 weeks).
                </>
              )}
            </>
          ) : (
            <>
              Schedule data unavailable — using the flat Available Hours/Week
              setting from Goals.
            </>
          )}
        </p>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
          <Card className="border-green-200 bg-green-50 p-4 dark:border-green-900 dark:bg-green-950">
            <div className="mb-1 flex items-center gap-2 text-green-700 dark:text-green-400">
              <TrendingUp className="h-4 w-4" />
              <p className="text-sm font-medium">YTD Potential Revenue</p>
            </div>
            <p className="text-2xl font-bold text-green-700 dark:text-green-400">
              {formatCurrency(stats.potential.revenueAtFullUtilizationYTD)}
            </p>
            <p className="mt-1 text-xs text-green-600 dark:text-green-500">
              At {stats.yearToDate.availableHours.toFixed(0)} available hours
            </p>
          </Card>

          <Card className="border-red-200 bg-red-50 p-4 dark:border-red-900 dark:bg-red-950">
            <div className="mb-1 flex items-center gap-2 text-red-700 dark:text-red-400">
              <TrendingDown className="h-4 w-4" />
              <p className="text-sm font-medium">YTD Left on Table</p>
            </div>
            <p className="text-2xl font-bold text-red-700 dark:text-red-400">
              {formatCurrency(stats.potential.revenueLeftOnTableYTD)}
            </p>
            <p className="mt-1 text-xs text-red-600 dark:text-red-500">
              {(100 - stats.yearToDate.utilization).toFixed(1)}% unused capacity
            </p>
          </Card>

          <Card className="border-green-200 bg-green-50 p-4 dark:border-green-900 dark:bg-green-950">
            <div className="mb-1 flex items-center gap-2 text-green-700 dark:text-green-400">
              <DollarSign className="h-4 w-4" />
              <p className="text-sm font-medium">Annual Potential</p>
            </div>
            <p className="text-2xl font-bold text-green-700 dark:text-green-400">
              {formatCurrency(stats.potential.annualRevenueAtFullUtilization)}
            </p>
            <p className="mt-1 text-xs text-green-600 dark:text-green-500">
              At ${stats.yearToDate.revenuePerHour.toFixed(0)}/hr ×{' '}
              {Math.round(stats.potential.totalAvailableHoursAnnual)} hrs
            </p>
          </Card>

          <Card className="border-red-200 bg-red-50 p-4 dark:border-red-900 dark:bg-red-950">
            <div className="mb-1 flex items-center gap-2 text-red-700 dark:text-red-400">
              <TrendingDown className="h-4 w-4" />
              <p className="text-sm font-medium">Annual Left on Table</p>
            </div>
            <p className="text-2xl font-bold text-red-700 dark:text-red-400">
              {formatCurrency(stats.potential.annualRevenueLeftOnTable)}
            </p>
            <p className="mt-1 text-xs text-red-600 dark:text-red-500">
              Projected gap vs 100% utilization
            </p>
          </Card>
        </div>
      </div>

      {/* Pace Tracking */}
      <div>
        <h2 className="text-gradient-purple mb-4 text-xl font-semibold tracking-tight">
          Pace to Goal
        </h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
          <Card className="p-4">
            <p className="text-muted-foreground mb-1 text-sm font-medium">
              Annual Goal
            </p>
            <p className="text-2xl font-bold">
              {formatCurrency(settings.annual_revenue_goal)}
            </p>
          </Card>

          <Card className="p-4">
            <p className="text-muted-foreground mb-1 text-sm font-medium">
              Weekly Target
            </p>
            <p className="text-2xl font-bold">
              {formatCurrency(stats.pace.weeklyTarget)}
            </p>
          </Card>

          <Card className="p-4">
            <p className="text-muted-foreground mb-1 text-sm font-medium">
              Current Weekly Avg
            </p>
            <p className="text-2xl font-bold">
              {formatCurrency(stats.pace.weeklyAverage)}
            </p>
          </Card>

          <Card
            className={`p-4 ${stats.pace.onPace ? 'bg-green-50 dark:bg-green-950/30' : 'bg-yellow-50 dark:bg-yellow-950/30'}`}
          >
            <div className="mb-1 flex items-center gap-2">
              {stats.pace.onPace ? (
                <TrendingUp className="h-4 w-4 text-green-600 dark:text-green-400" />
              ) : (
                <TrendingDown className="h-4 w-4 text-yellow-600 dark:text-yellow-400" />
              )}
              <p className="text-sm font-medium">Status</p>
            </div>
            <p
              className={`text-2xl font-bold ${stats.pace.onPace ? 'text-green-600 dark:text-green-400' : 'text-yellow-600 dark:text-yellow-400'}`}
            >
              {stats.pace.onPace ? 'On Pace' : 'Behind Pace'}
            </p>
          </Card>
        </div>

        <Card className="mt-4 p-6">
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <p className="font-medium">Projected Annual Revenue</p>
              <p className="text-2xl font-bold">
                {formatCurrency(stats.pace.projectedAnnual)}
              </p>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <p className="text-muted-foreground">Progress to Goal</p>
                <p className="font-medium">
                  {stats.pace.percentOfGoal.toFixed(1)}%
                </p>
              </div>
              <div className="bg-muted h-3 w-full rounded-full">
                <div
                  className={`h-3 rounded-full transition-all ${stats.pace.onPace ? 'bg-green-500' : 'bg-yellow-500'}`}
                  style={{
                    width: `${Math.min(stats.pace.percentOfGoal, 100)}%`,
                  }}
                />
              </div>
            </div>

            {!stats.pace.onPace && (
              <p className="text-sm text-yellow-600 dark:text-yellow-400">
                Need to average {formatCurrency(stats.pace.weeklyTarget)} per
                week to reach goal
              </p>
            )}
          </div>
        </Card>
      </div>
    </div>
  )
}
