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
  Users,
} from 'lucide-react'

type Settings = {
  annual_revenue_goal: number
  available_hours_per_week: number
  work_weeks_per_year: number
  hiring_threshold: number
  hiring_consecutive_weeks: number
}

type WeeklyRevenueData = {
  weekStart: Date
  weekEnd: Date
  revenue: number
  jobs: number
  hours: number
  meetsThreshold: boolean
  isCurrentWeek: boolean
}

type HiringReadiness = {
  currentWeekRevenue: number
  consecutiveWeeks: number
  requiredWeeks: number
  threshold: number
  status: 'NOT_YET' | 'GETTING_CLOSE' | 'START_RECRUITING'
  recentWeeks: WeeklyRevenueData[]
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
  }
}

export default function StatsPage() {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [stats, setStats] = useState<Stats | null>(null)
  const [hiringReadiness, setHiringReadiness] =
    useState<HiringReadiness | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

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

      // Fetch revenue entries
      const { data: entries, error: entriesError } = await supabase
        .from('revenue_entries')
        .select('invoice_amount, hours_worked, entry_date')
        .eq('user_id', user.id)
        .order('entry_date', { ascending: false })

      if (entriesError) throw entriesError

      // Combine jobs and entries for calculations
      const allRevenue = [
        ...(jobs || []).map((j) => ({ ...j, date: j.created_at })),
        ...(entries || []).map((e) => ({ ...e, date: e.entry_date })),
      ]

      // Calculate stats
      const now = new Date()
      const startOfWeek = new Date(now)
      startOfWeek.setDate(now.getDate() - now.getDay()) // Sunday
      startOfWeek.setHours(0, 0, 0, 0)

      const startOfYear = new Date(now.getFullYear(), 0, 1)

      // Filter by date
      const thisWeekData = allRevenue.filter(
        (item) => new Date(item.date) >= startOfWeek,
      )
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

      // Calculations
      const weeksElapsed = Math.ceil(
        (now.getTime() - startOfYear.getTime()) / (7 * 24 * 60 * 60 * 1000),
      )
      const availableHoursYTD =
        weeksElapsed * userSettings.available_hours_per_week
      const utilization =
        availableHoursYTD > 0 ? (ytdHours / availableHoursYTD) * 100 : 0

      const weeklyTarget =
        userSettings.annual_revenue_goal / userSettings.work_weeks_per_year
      const weeklyAverage = weeksElapsed > 0 ? ytdRevenue / weeksElapsed : 0
      const projectedAnnual = weeklyAverage * userSettings.work_weeks_per_year
      const onPace = projectedAnnual >= userSettings.annual_revenue_goal
      const percentOfGoal =
        (ytdRevenue / userSettings.annual_revenue_goal) * 100

      // Potential revenue calculations
      const revenuePerHour = ytdHours > 0 ? ytdRevenue / ytdHours : 0
      const totalAvailableHoursAnnual =
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
        },
      })

      // Calculate Hiring Readiness
      const hiringThreshold = userSettings.hiring_threshold
      const requiredWeeks = userSettings.hiring_consecutive_weeks

      // Get Monday of current week (ISO week standard)
      const getMonday = (d: Date) => {
        const date = new Date(d)
        const day = date.getDay()
        const diff = date.getDate() - day + (day === 0 ? -6 : 1) // Adjust when day is Sunday
        date.setDate(diff)
        date.setHours(0, 0, 0, 0)
        return date
      }

      // Generate last 8 weeks of data
      const recentWeeks: WeeklyRevenueData[] = []
      const currentMonday = getMonday(now)

      for (let i = 0; i < 8; i++) {
        const weekStart = new Date(currentMonday)
        weekStart.setDate(weekStart.getDate() - i * 7)

        const weekEnd = new Date(weekStart)
        weekEnd.setDate(weekEnd.getDate() + 6)
        weekEnd.setHours(23, 59, 59, 999)

        // Filter revenue data for this week
        const weekData = allRevenue.filter((item) => {
          const itemDate = new Date(item.date)
          return itemDate >= weekStart && itemDate <= weekEnd
        })

        const weekRevenue = weekData.reduce(
          (sum, item) => sum + (item.invoice_amount || 0),
          0,
        )
        const weekHours = weekData.reduce(
          (sum, item) => sum + (item.hours_worked || 0),
          0,
        )

        recentWeeks.push({
          weekStart,
          weekEnd,
          revenue: weekRevenue,
          jobs: weekData.length,
          hours: weekHours,
          meetsThreshold: weekRevenue >= hiringThreshold,
          isCurrentWeek: i === 0,
        })
      }

      // Count consecutive weeks meeting threshold (starting from most recent COMPLETE week)
      let consecutiveWeeks = 0
      // Start from week 1 (last complete week) unless current week meets threshold
      const startIndex = recentWeeks[0].meetsThreshold ? 0 : 1

      for (let i = startIndex; i < recentWeeks.length; i++) {
        if (recentWeeks[i].meetsThreshold) {
          consecutiveWeeks++
        } else {
          break
        }
      }

      // Determine status
      let hiringStatus: 'NOT_YET' | 'GETTING_CLOSE' | 'START_RECRUITING'
      if (consecutiveWeeks >= requiredWeeks) {
        hiringStatus = 'START_RECRUITING'
      } else if (consecutiveWeeks >= 2) {
        hiringStatus = 'GETTING_CLOSE'
      } else {
        hiringStatus = 'NOT_YET'
      }

      setHiringReadiness({
        currentWeekRevenue: recentWeeks[0].revenue,
        consecutiveWeeks,
        requiredWeeks,
        threshold: hiringThreshold,
        status: hiringStatus,
        recentWeeks: recentWeeks.slice(0, 4), // Show last 4 weeks
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
            <h1 className="text-2xl font-bold md:text-3xl">
              Utilization Tracker
            </h1>
            <p className="text-muted-foreground mt-1 text-sm md:mt-2 md:text-base">
              Track revenue, efficiency, and progress toward your annual goal
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

      {/* This Week */}
      <div className="mb-8">
        <h2 className="mb-4 text-xl font-semibold">This Week</h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3 lg:grid-cols-5">
          <Card className="p-4">
            <div className="text-muted-foreground mb-1 flex items-center gap-2">
              <Briefcase className="h-4 w-4" />
              <p className="text-sm font-medium">Jobs</p>
            </div>
            <p className="text-2xl font-bold">{stats.thisWeek.jobs}</p>
          </Card>

          <Card className="p-4">
            <div className="text-muted-foreground mb-1 flex items-center gap-2">
              <DollarSign className="h-4 w-4" />
              <p className="text-sm font-medium">Revenue</p>
            </div>
            <p className="text-2xl font-bold">
              {formatCurrency(stats.thisWeek.revenue)}
            </p>
          </Card>

          <Card className="p-4">
            <div className="text-muted-foreground mb-1 flex items-center gap-2">
              <Clock className="h-4 w-4" />
              <p className="text-sm font-medium">Hours</p>
            </div>
            <p className="text-2xl font-bold">
              {stats.thisWeek.hours.toFixed(1)}
            </p>
          </Card>

          <Card className="p-4">
            <div className="text-muted-foreground mb-1 flex items-center gap-2">
              <TrendingUp className="h-4 w-4" />
              <p className="text-sm font-medium">$/Hour</p>
            </div>
            <p className="text-2xl font-bold">
              {formatCurrency(stats.thisWeek.revenuePerHour)}
            </p>
          </Card>

          <Card className="p-4">
            <div className="text-muted-foreground mb-1 flex items-center gap-2">
              <DollarSign className="h-4 w-4" />
              <p className="text-sm font-medium">Avg Ticket</p>
            </div>
            <p className="text-2xl font-bold">
              {formatCurrency(stats.thisWeek.averageTicket)}
            </p>
          </Card>
        </div>
      </div>

      {/* Year to Date */}
      <div className="mb-8">
        <h2 className="mb-4 text-xl font-semibold">Year to Date</h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3 lg:grid-cols-5">
          <Card className="p-4">
            <div className="text-muted-foreground mb-1 flex items-center gap-2">
              <Briefcase className="h-4 w-4" />
              <p className="text-sm font-medium">Total Jobs</p>
            </div>
            <p className="text-2xl font-bold">{stats.yearToDate.jobs}</p>
          </Card>

          <Card className="p-4">
            <div className="text-muted-foreground mb-1 flex items-center gap-2">
              <DollarSign className="h-4 w-4" />
              <p className="text-sm font-medium">Total Revenue</p>
            </div>
            <p className="text-2xl font-bold">
              {formatCurrency(stats.yearToDate.revenue)}
            </p>
          </Card>

          <Card className="p-4">
            <div className="text-muted-foreground mb-1 flex items-center gap-2">
              <Clock className="h-4 w-4" />
              <p className="text-sm font-medium">Total Hours</p>
            </div>
            <p className="text-2xl font-bold">
              {stats.yearToDate.hours.toFixed(1)}
            </p>
          </Card>

          <Card className="p-4">
            <div className="text-muted-foreground mb-1 flex items-center gap-2">
              <TrendingUp className="h-4 w-4" />
              <p className="text-sm font-medium">Avg $/Hour</p>
            </div>
            <p className="text-2xl font-bold">
              {formatCurrency(stats.yearToDate.revenuePerHour)}
            </p>
          </Card>

          <Card className="p-4">
            <div className="text-muted-foreground mb-1 flex items-center gap-2">
              <Target className="h-4 w-4" />
              <p className="text-sm font-medium">Utilization</p>
            </div>
            <p className="text-2xl font-bold">
              {stats.yearToDate.utilization.toFixed(1)}%
            </p>
          </Card>
        </div>
      </div>

      {/* Potential Revenue - Money Left on Table */}
      <div className="mb-8">
        <h2 className="mb-4 text-xl font-semibold">
          Potential at 100% Utilization
        </h2>
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
              {stats.potential.totalAvailableHoursAnnual} hrs
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
        <h2 className="mb-4 text-xl font-semibold">Pace to Goal</h2>
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

      {/* Hiring Readiness */}
      {hiringReadiness && (
        <div className="mt-8">
          <h2 className="mb-4 flex items-center gap-2 text-xl font-semibold">
            <Rocket className="h-5 w-5" />
            Hiring Readiness
          </h2>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            {/* Trigger Info */}
            <Card className="p-4">
              <div className="text-muted-foreground mb-1 flex items-center gap-2">
                <Target className="h-4 w-4" />
                <p className="text-sm font-medium">Trigger</p>
              </div>
              <p className="text-lg font-semibold">
                {formatCurrency(hiringReadiness.threshold)}/week
              </p>
              <p className="text-muted-foreground text-sm">
                for {hiringReadiness.requiredWeeks} consecutive weeks
              </p>
            </Card>

            {/* Current Week */}
            <Card
              className={`p-4 ${
                hiringReadiness.recentWeeks[0]?.meetsThreshold
                  ? 'border-green-200 bg-green-50 dark:border-green-900 dark:bg-green-950/30'
                  : 'border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-800/30'
              }`}
            >
              <div className="text-muted-foreground mb-1 flex items-center gap-2">
                <DollarSign className="h-4 w-4" />
                <p className="text-sm font-medium">
                  Current Week (in progress)
                </p>
              </div>
              <p className="text-2xl font-bold">
                {formatCurrency(hiringReadiness.currentWeekRevenue)}
              </p>
              <div className="mt-1 flex items-center gap-2">
                <span
                  className={`inline-block h-3 w-3 rounded-full ${
                    hiringReadiness.recentWeeks[0]?.meetsThreshold
                      ? 'bg-green-500'
                      : 'bg-gray-400'
                  }`}
                />
                <span
                  className={`text-sm ${
                    hiringReadiness.recentWeeks[0]?.meetsThreshold
                      ? 'text-green-600 dark:text-green-400'
                      : 'text-muted-foreground'
                  }`}
                >
                  {hiringReadiness.recentWeeks[0]?.meetsThreshold
                    ? 'Above threshold'
                    : 'Below threshold'}
                </span>
              </div>
            </Card>

            {/* Consecutive Weeks */}
            <Card className="p-4">
              <div className="text-muted-foreground mb-1 flex items-center gap-2">
                <Users className="h-4 w-4" />
                <p className="text-sm font-medium">Consecutive Weeks</p>
              </div>
              <p className="text-2xl font-bold">
                {hiringReadiness.consecutiveWeeks} of{' '}
                {hiringReadiness.requiredWeeks}
              </p>
              {/* Progress bar */}
              <div className="mt-2">
                <div className="bg-muted h-3 w-full overflow-hidden rounded-full">
                  <div
                    className={`h-3 transition-all ${
                      hiringReadiness.consecutiveWeeks >=
                      hiringReadiness.requiredWeeks
                        ? 'bg-green-500'
                        : hiringReadiness.consecutiveWeeks >= 2
                          ? 'bg-yellow-500'
                          : 'bg-gray-400'
                    }`}
                    style={{
                      width: `${Math.min(
                        (hiringReadiness.consecutiveWeeks /
                          hiringReadiness.requiredWeeks) *
                          100,
                        100,
                      )}%`,
                    }}
                  />
                </div>
                <p className="text-muted-foreground mt-1 text-right text-xs">
                  {Math.round(
                    (hiringReadiness.consecutiveWeeks /
                      hiringReadiness.requiredWeeks) *
                      100,
                  )}
                  %
                </p>
              </div>
            </Card>
          </div>

          {/* Status Card */}
          <Card
            className={`mt-4 p-6 ${
              hiringReadiness.status === 'START_RECRUITING'
                ? 'bg-green-600 dark:bg-green-700'
                : hiringReadiness.status === 'GETTING_CLOSE'
                  ? 'bg-amber-500 dark:bg-amber-600'
                  : 'bg-gray-600 dark:bg-gray-700'
            }`}
          >
            <div className="flex items-center justify-between">
              <div>
                <p className="mb-1 text-sm font-medium text-white/80">Status</p>
                <p
                  className={`text-2xl font-bold ${
                    hiringReadiness.status === 'GETTING_CLOSE'
                      ? 'text-black'
                      : 'text-white'
                  }`}
                >
                  {hiringReadiness.status === 'START_RECRUITING' &&
                    'TIME TO HIRE!'}
                  {hiringReadiness.status === 'GETTING_CLOSE' &&
                    'GETTING CLOSE'}
                  {hiringReadiness.status === 'NOT_YET' && 'NOT YET'}
                </p>
              </div>
              <div
                className={`text-right ${
                  hiringReadiness.status === 'GETTING_CLOSE'
                    ? 'text-black/70'
                    : 'text-white/80'
                }`}
              >
                <p className="text-sm">
                  {hiringReadiness.status === 'START_RECRUITING' &&
                    'Start recruiting now'}
                  {hiringReadiness.status === 'GETTING_CLOSE' &&
                    `${hiringReadiness.requiredWeeks - hiringReadiness.consecutiveWeeks} more weeks to go`}
                  {hiringReadiness.status === 'NOT_YET' &&
                    'Keep building momentum'}
                </p>
              </div>
            </div>
          </Card>

          {/* Recent Weeks */}
          <Card className="mt-4 p-4">
            <h3 className="mb-3 font-medium">Recent Weeks</h3>
            <div className="space-y-2">
              {hiringReadiness.recentWeeks.map((week, index) => (
                <div
                  key={week.weekStart.toISOString()}
                  className={`flex items-center justify-between rounded-lg p-3 ${
                    week.meetsThreshold
                      ? 'bg-green-50 dark:bg-green-950/30'
                      : 'bg-gray-50 dark:bg-gray-800/30'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <span
                      className={`inline-block h-3 w-3 rounded-full ${
                        week.meetsThreshold ? 'bg-green-500' : 'bg-gray-400'
                      }`}
                    />
                    <span className="font-medium">
                      {index === 0
                        ? 'This Week'
                        : index === 1
                          ? 'Last Week'
                          : `${index} Weeks Ago`}
                    </span>
                    {week.isCurrentWeek && (
                      <span className="rounded bg-blue-100 px-2 py-0.5 text-xs text-blue-700 dark:bg-blue-900 dark:text-blue-300">
                        in progress
                      </span>
                    )}
                  </div>
                  <div className="text-right">
                    <span
                      className={`font-bold ${
                        week.meetsThreshold
                          ? 'text-green-600 dark:text-green-400'
                          : 'text-muted-foreground'
                      }`}
                    >
                      {formatCurrency(week.revenue)}
                    </span>
                    <span className="text-muted-foreground ml-2 text-sm">
                      ({week.jobs} jobs)
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>
      )}
    </div>
  )
}
