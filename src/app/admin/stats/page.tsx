'use client'

import { useEffect, useState } from 'react'
import { Card } from '@/components/ui/card'
import { createClient } from '@/supabase/client'
import { Loader2, DollarSign, Clock, TrendingUp, TrendingDown, Target, Briefcase } from 'lucide-react'

type Settings = {
  annual_revenue_goal: number
  available_hours_per_week: number
  work_weeks_per_year: number
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
  }
  pace: {
    weeklyTarget: number
    weeklyAverage: number
    projectedAnnual: number
    onPace: boolean
    percentOfGoal: number
  }
}

export default function StatsPage() {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [stats, setStats] = useState<Stats | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function fetchData() {
      try {
        const supabase = createClient()
        
        // Fetch user settings (or create default)
        const { data: { user } } = await supabase.auth.getUser()
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
          }
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

        // Calculate stats
        const now = new Date()
        const startOfWeek = new Date(now)
        startOfWeek.setDate(now.getDate() - now.getDay()) // Sunday
        startOfWeek.setHours(0, 0, 0, 0)

        const startOfYear = new Date(now.getFullYear(), 0, 1)
        
        // Filter jobs
        const jobsThisWeek = jobs?.filter(j => new Date(j.created_at) >= startOfWeek) || []
        const jobsYTD = jobs?.filter(j => new Date(j.created_at) >= startOfYear) || []

        // This Week
        const thisWeekRevenue = jobsThisWeek.reduce((sum, j) => sum + (j.invoice_amount || 0), 0)
        const thisWeekHours = jobsThisWeek.reduce((sum, j) => sum + (j.hours_worked || 0), 0)
        
        // Year to Date
        const ytdRevenue = jobsYTD.reduce((sum, j) => sum + (j.invoice_amount || 0), 0)
        const ytdHours = jobsYTD.reduce((sum, j) => sum + (j.hours_worked || 0), 0)
        
        // Calculations
        const weeksElapsed = Math.ceil((now.getTime() - startOfYear.getTime()) / (7 * 24 * 60 * 60 * 1000))
        const availableHoursYTD = weeksElapsed * userSettings.available_hours_per_week
        const utilization = availableHoursYTD > 0 ? (ytdHours / availableHoursYTD) * 100 : 0
        
        const weeklyTarget = userSettings.annual_revenue_goal / userSettings.work_weeks_per_year
        const weeklyAverage = weeksElapsed > 0 ? ytdRevenue / weeksElapsed : 0
        const projectedAnnual = weeklyAverage * userSettings.work_weeks_per_year
        const onPace = projectedAnnual >= userSettings.annual_revenue_goal
        const percentOfGoal = (ytdRevenue / userSettings.annual_revenue_goal) * 100

        setStats({
          thisWeek: {
            jobs: jobsThisWeek.length,
            revenue: thisWeekRevenue,
            hours: thisWeekHours,
            revenuePerHour: thisWeekHours > 0 ? thisWeekRevenue / thisWeekHours : 0,
            averageTicket: jobsThisWeek.length > 0 ? thisWeekRevenue / jobsThisWeek.length : 0,
          },
          yearToDate: {
            jobs: jobsYTD.length,
            revenue: ytdRevenue,
            hours: ytdHours,
            revenuePerHour: ytdHours > 0 ? ytdRevenue / ytdHours : 0,
            utilization,
          },
          pace: {
            weeklyTarget,
            weeklyAverage,
            projectedAnnual,
            onPace,
            percentOfGoal,
          },
        })
      } catch (err) {
        console.error('Error fetching stats:', err)
        setError(err instanceof Error ? err.message : 'Failed to load stats')
      } finally {
        setIsLoading(false)
      }
    }

    fetchData()
  }, [])

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="rounded-md bg-destructive/10 p-4 text-destructive">
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
    <div className="container mx-auto px-4 py-8 max-w-6xl">
      <div className="mb-8">
        <h1 className="text-3xl font-bold">Utilization Tracker</h1>
        <p className="text-muted-foreground mt-2">
          Track revenue, efficiency, and progress toward your annual goal
        </p>
      </div>

      {/* This Week */}
      <div className="mb-8">
        <h2 className="text-xl font-semibold mb-4">This Week</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-4">
          <Card className="p-4">
            <div className="flex items-center gap-2 text-muted-foreground mb-1">
              <Briefcase className="h-4 w-4" />
              <p className="text-sm font-medium">Jobs</p>
            </div>
            <p className="text-2xl font-bold">{stats.thisWeek.jobs}</p>
          </Card>

          <Card className="p-4">
            <div className="flex items-center gap-2 text-muted-foreground mb-1">
              <DollarSign className="h-4 w-4" />
              <p className="text-sm font-medium">Revenue</p>
            </div>
            <p className="text-2xl font-bold">{formatCurrency(stats.thisWeek.revenue)}</p>
          </Card>

          <Card className="p-4">
            <div className="flex items-center gap-2 text-muted-foreground mb-1">
              <Clock className="h-4 w-4" />
              <p className="text-sm font-medium">Hours</p>
            </div>
            <p className="text-2xl font-bold">{stats.thisWeek.hours.toFixed(1)}</p>
          </Card>

          <Card className="p-4">
            <div className="flex items-center gap-2 text-muted-foreground mb-1">
              <TrendingUp className="h-4 w-4" />
              <p className="text-sm font-medium">$/Hour</p>
            </div>
            <p className="text-2xl font-bold">
              {formatCurrency(stats.thisWeek.revenuePerHour)}
            </p>
          </Card>

          <Card className="p-4">
            <div className="flex items-center gap-2 text-muted-foreground mb-1">
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
        <h2 className="text-xl font-semibold mb-4">Year to Date</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-4">
          <Card className="p-4">
            <div className="flex items-center gap-2 text-muted-foreground mb-1">
              <Briefcase className="h-4 w-4" />
              <p className="text-sm font-medium">Total Jobs</p>
            </div>
            <p className="text-2xl font-bold">{stats.yearToDate.jobs}</p>
          </Card>

          <Card className="p-4">
            <div className="flex items-center gap-2 text-muted-foreground mb-1">
              <DollarSign className="h-4 w-4" />
              <p className="text-sm font-medium">Total Revenue</p>
            </div>
            <p className="text-2xl font-bold">{formatCurrency(stats.yearToDate.revenue)}</p>
          </Card>

          <Card className="p-4">
            <div className="flex items-center gap-2 text-muted-foreground mb-1">
              <Clock className="h-4 w-4" />
              <p className="text-sm font-medium">Total Hours</p>
            </div>
            <p className="text-2xl font-bold">{stats.yearToDate.hours.toFixed(1)}</p>
          </Card>

          <Card className="p-4">
            <div className="flex items-center gap-2 text-muted-foreground mb-1">
              <TrendingUp className="h-4 w-4" />
              <p className="text-sm font-medium">Avg $/Hour</p>
            </div>
            <p className="text-2xl font-bold">
              {formatCurrency(stats.yearToDate.revenuePerHour)}
            </p>
          </Card>

          <Card className="p-4">
            <div className="flex items-center gap-2 text-muted-foreground mb-1">
              <Target className="h-4 w-4" />
              <p className="text-sm font-medium">Utilization</p>
            </div>
            <p className="text-2xl font-bold">{stats.yearToDate.utilization.toFixed(1)}%</p>
          </Card>
        </div>
      </div>

      {/* Pace Tracking */}
      <div>
        <h2 className="text-xl font-semibold mb-4">Pace to Goal</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <Card className="p-4">
            <p className="text-sm font-medium text-muted-foreground mb-1">
              Annual Goal
            </p>
            <p className="text-2xl font-bold">{formatCurrency(settings.annual_revenue_goal)}</p>
          </Card>

          <Card className="p-4">
            <p className="text-sm font-medium text-muted-foreground mb-1">
              Weekly Target
            </p>
            <p className="text-2xl font-bold">{formatCurrency(stats.pace.weeklyTarget)}</p>
          </Card>

          <Card className="p-4">
            <p className="text-sm font-medium text-muted-foreground mb-1">
              Current Weekly Avg
            </p>
            <p className="text-2xl font-bold">{formatCurrency(stats.pace.weeklyAverage)}</p>
          </Card>

          <Card className={`p-4 ${stats.pace.onPace ? 'bg-green-50 dark:bg-green-950/30' : 'bg-yellow-50 dark:bg-yellow-950/30'}`}>
            <div className="flex items-center gap-2 mb-1">
              {stats.pace.onPace ? (
                <TrendingUp className="h-4 w-4 text-green-600 dark:text-green-400" />
              ) : (
                <TrendingDown className="h-4 w-4 text-yellow-600 dark:text-yellow-400" />
              )}
              <p className="text-sm font-medium">Status</p>
            </div>
            <p className={`text-2xl font-bold ${stats.pace.onPace ? 'text-green-600 dark:text-green-400' : 'text-yellow-600 dark:text-yellow-400'}`}>
              {stats.pace.onPace ? 'On Pace' : 'Behind Pace'}
            </p>
          </Card>
        </div>

        <Card className="mt-4 p-6">
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <p className="font-medium">Projected Annual Revenue</p>
              <p className="text-2xl font-bold">{formatCurrency(stats.pace.projectedAnnual)}</p>
            </div>
            
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <p className="text-muted-foreground">Progress to Goal</p>
                <p className="font-medium">{stats.pace.percentOfGoal.toFixed(1)}%</p>
              </div>
              <div className="w-full bg-muted rounded-full h-3">
                <div
                  className={`h-3 rounded-full transition-all ${stats.pace.onPace ? 'bg-green-500' : 'bg-yellow-500'}`}
                  style={{ width: `${Math.min(stats.pace.percentOfGoal, 100)}%` }}
                />
              </div>
            </div>

            {!stats.pace.onPace && (
              <p className="text-sm text-yellow-600 dark:text-yellow-400">
                Need to average {formatCurrency(stats.pace.weeklyTarget)} per week to reach goal
              </p>
            )}
          </div>
        </Card>
      </div>
    </div>
  )
}
