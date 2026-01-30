'use client'

import { useEffect, useState } from 'react'
import { Card } from '@/components/ui/card'
import { createClient } from '@/supabase/client'
import {
  Phone,
  MessageSquare,
  Download,
  FileText,
  TrendingUp,
  Users,
  Calendar,
} from 'lucide-react'

type NfcCardTap = {
  id: string
  card_id: string | null
  partner_id: string | null
  tap_type: string
  ip_address: string
  user_agent: string
  device_type: string
  location_city: string | null
  location_region: string | null
  location_country: string | null
  converted: boolean
  lead_id: string | null
  conversion_type: string | null
  tapped_at: string
  converted_at: string | null
  created_at: string
}

type NfcButtonClick = {
  id: string
  tap_id: string
  button_type: string
  clicked_at: string
}

type TapStats = {
  totalTaps: number
  uniqueTaps: number
  conversions: number
  conversionRate: number
  callClicks: number
  textClicks: number
  formSubmits: number
  saveContactClicks: number
  todayTaps: number
  weekTaps: number
  monthTaps: number
  topCities: { city: string; count: number }[]
  deviceBreakdown: { mobile: number; tablet: number; desktop: number }
}

export default function TapAnalyticsPage() {
  const [stats, setStats] = useState<TapStats | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [timeframe, setTimeframe] = useState<
    'today' | 'week' | 'month' | 'all'
  >('all')

  useEffect(() => {
    fetchStats()
  }, [timeframe])

  const fetchStats = async () => {
    setIsLoading(true)
    try {
      const supabase = createClient()

      // Calculate date range
      const now = new Date()
      let startDate = new Date(0) // Beginning of time
      if (timeframe === 'today') {
        startDate = new Date(now.setHours(0, 0, 0, 0))
      } else if (timeframe === 'week') {
        startDate = new Date(now.setDate(now.getDate() - 7))
      } else if (timeframe === 'month') {
        startDate = new Date(now.setDate(now.getDate() - 30))
      }

      // Fetch taps
      const { data: taps, error: tapsError } = await supabase
        .from('nfc_card_taps')
        .select('*')
        .gte('tapped_at', startDate.toISOString())

      if (tapsError) throw tapsError

      // Fetch button clicks
      const tapIds = (taps as NfcCardTap[])?.map((t) => t.id) || []
      const { data: clicks, error: clicksError } = await supabase
        .from('nfc_button_clicks')
        .select('*')
        .in('tap_id', tapIds)

      if (clicksError) throw clicksError

      // Cast to proper types
      const tapData = (taps as NfcCardTap[]) || []
      const clickData = (clicks as NfcButtonClick[]) || []

      // Calculate stats
      const totalTaps = tapData.length
      const uniqueTaps = new Set(tapData.map((t) => t.ip_address)).size
      const conversions = tapData.filter((t) => t.converted).length
      const conversionRate = totalTaps > 0 ? (conversions / totalTaps) * 100 : 0

      const callClicks = clickData.filter(
        (c) => c.button_type === 'call',
      ).length
      const textClicks = clickData.filter(
        (c) => c.button_type === 'text',
      ).length
      const formSubmits = clickData.filter(
        (c) => c.button_type === 'form_submit',
      ).length
      const saveContactClicks = clickData.filter(
        (c) => c.button_type === 'save_contact',
      ).length

      // Time-based stats
      const todayStart = new Date()
      todayStart.setHours(0, 0, 0, 0)
      const todayTaps = tapData.filter(
        (t) => new Date(t.tapped_at) >= todayStart,
      ).length

      const weekStart = new Date()
      weekStart.setDate(weekStart.getDate() - 7)
      const weekTaps = tapData.filter(
        (t) => new Date(t.tapped_at) >= weekStart,
      ).length

      const monthStart = new Date()
      monthStart.setDate(monthStart.getDate() - 30)
      const monthTaps = tapData.filter(
        (t) => new Date(t.tapped_at) >= monthStart,
      ).length

      // Top cities
      const cityCount: Record<string, number> = {}
      tapData.forEach((t) => {
        if (t.location_city) {
          cityCount[t.location_city] = (cityCount[t.location_city] || 0) + 1
        }
      })
      const topCities = Object.entries(cityCount)
        .map(([city, count]) => ({ city, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 5)

      // Device breakdown
      const deviceBreakdown = {
        mobile: tapData.filter((t) => t.device_type === 'mobile').length,
        tablet: tapData.filter((t) => t.device_type === 'tablet').length,
        desktop: tapData.filter((t) => t.device_type === 'desktop').length,
      }

      setStats({
        totalTaps,
        uniqueTaps,
        conversions,
        conversionRate,
        callClicks,
        textClicks,
        formSubmits,
        saveContactClicks,
        todayTaps,
        weekTaps,
        monthTaps,
        topCities,
        deviceBreakdown,
      })
    } catch (error) {
      console.error('Failed to fetch stats:', error)
    } finally {
      setIsLoading(false)
    }
  }

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p>Loading analytics...</p>
      </div>
    )
  }

  if (!stats) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p>Failed to load analytics</p>
      </div>
    )
  }

  const handleCopyURL = () => {
    const url = `${window.location.origin}/tap`
    navigator.clipboard.writeText(url)
    alert('URL copied to clipboard!')
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">NFC Card Analytics</h1>
        <div className="flex gap-2">
          {(['today', 'week', 'month', 'all'] as const).map((tf) => (
            <button
              key={tf}
              onClick={() => setTimeframe(tf)}
              className={`rounded px-3 py-1 text-sm ${
                timeframe === tf
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-200 dark:bg-gray-700'
              }`}
            >
              {tf === 'today'
                ? 'Today'
                : tf === 'week'
                  ? 'Week'
                  : tf === 'month'
                    ? 'Month'
                    : 'All Time'}
            </button>
          ))}
        </div>
      </div>

      {/* Landing Page Quick Links */}
      <Card className="border-blue-500 bg-blue-50 p-4 dark:bg-blue-950">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold text-blue-900 dark:text-blue-100">
              NFC Card Landing Page
            </p>
            <p className="text-xs text-blue-700 dark:text-blue-300">
              {typeof window !== 'undefined' && `${window.location.origin}/tap`}
            </p>
          </div>
          <div className="flex gap-2">
            <a
              href="/tap"
              target="_blank"
              rel="noopener noreferrer"
              className="rounded bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
            >
              View Landing Page
            </a>
            <button
              onClick={handleCopyURL}
              className="rounded bg-green-600 px-4 py-2 text-sm font-semibold text-white hover:bg-green-700"
            >
              Copy URL
            </button>
          </div>
        </div>
      </Card>

      {/* Overview Stats */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card className="p-4">
          <div className="flex items-center gap-2">
            <Users className="h-5 w-5 text-blue-500" />
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Total Taps
            </p>
          </div>
          <p className="mt-2 text-3xl font-bold">{stats.totalTaps}</p>
          <p className="text-xs text-gray-500">
            {stats.uniqueTaps} unique visitors
          </p>
        </Card>

        <Card className="p-4">
          <div className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-green-500" />
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Conversions
            </p>
          </div>
          <p className="mt-2 text-3xl font-bold">{stats.conversions}</p>
          <p className="text-xs text-gray-500">
            {stats.conversionRate.toFixed(1)}% conversion rate
          </p>
        </Card>

        <Card className="p-4">
          <div className="flex items-center gap-2">
            <Calendar className="h-5 w-5 text-purple-500" />
            <p className="text-sm text-gray-600 dark:text-gray-400">
              This Week
            </p>
          </div>
          <p className="mt-2 text-3xl font-bold">{stats.weekTaps}</p>
          <p className="text-xs text-gray-500">{stats.todayTaps} today</p>
        </Card>

        <Card className="p-4">
          <div className="flex items-center gap-2">
            <Phone className="h-5 w-5 text-orange-500" />
            <p className="text-sm text-gray-600 dark:text-gray-400">Calls</p>
          </div>
          <p className="mt-2 text-3xl font-bold">{stats.callClicks}</p>
          <p className="text-xs text-gray-500">Call button clicks</p>
        </Card>
      </div>

      {/* Button Engagement */}
      <Card className="p-6">
        <h2 className="mb-4 text-xl font-bold">Button Engagement</h2>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <div className="text-center">
            <Phone className="mx-auto mb-2 h-8 w-8 text-green-500" />
            <p className="text-2xl font-bold">{stats.callClicks}</p>
            <p className="text-sm text-gray-600 dark:text-gray-400">Calls</p>
          </div>
          <div className="text-center">
            <MessageSquare className="mx-auto mb-2 h-8 w-8 text-blue-500" />
            <p className="text-2xl font-bold">{stats.textClicks}</p>
            <p className="text-sm text-gray-600 dark:text-gray-400">Texts</p>
          </div>
          <div className="text-center">
            <FileText className="mx-auto mb-2 h-8 w-8 text-purple-500" />
            <p className="text-2xl font-bold">{stats.formSubmits}</p>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Form Submits
            </p>
          </div>
          <div className="text-center">
            <Download className="mx-auto mb-2 h-8 w-8 text-orange-500" />
            <p className="text-2xl font-bold">{stats.saveContactClicks}</p>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Save Contact
            </p>
          </div>
        </div>
      </Card>

      {/* Device Breakdown */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Card className="p-6">
          <h2 className="mb-4 text-xl font-bold">Device Types</h2>
          <div className="space-y-3">
            <div>
              <div className="mb-1 flex justify-between text-sm">
                <span>📱 Mobile</span>
                <span className="font-bold">
                  {stats.deviceBreakdown.mobile}
                </span>
              </div>
              <div className="h-2 w-full rounded-full bg-gray-200 dark:bg-gray-700">
                <div
                  className="h-2 rounded-full bg-blue-500"
                  style={{
                    width: `${(stats.deviceBreakdown.mobile / stats.totalTaps) * 100}%`,
                  }}
                />
              </div>
            </div>
            <div>
              <div className="mb-1 flex justify-between text-sm">
                <span>💻 Desktop</span>
                <span className="font-bold">
                  {stats.deviceBreakdown.desktop}
                </span>
              </div>
              <div className="h-2 w-full rounded-full bg-gray-200 dark:bg-gray-700">
                <div
                  className="h-2 rounded-full bg-green-500"
                  style={{
                    width: `${(stats.deviceBreakdown.desktop / stats.totalTaps) * 100}%`,
                  }}
                />
              </div>
            </div>
            <div>
              <div className="mb-1 flex justify-between text-sm">
                <span>📲 Tablet</span>
                <span className="font-bold">
                  {stats.deviceBreakdown.tablet}
                </span>
              </div>
              <div className="h-2 w-full rounded-full bg-gray-200 dark:bg-gray-700">
                <div
                  className="h-2 rounded-full bg-purple-500"
                  style={{
                    width: `${(stats.deviceBreakdown.tablet / stats.totalTaps) * 100}%`,
                  }}
                />
              </div>
            </div>
          </div>
        </Card>

        <Card className="p-6">
          <h2 className="mb-4 text-xl font-bold">Top Cities</h2>
          {stats.topCities.length > 0 ? (
            <div className="space-y-2">
              {stats.topCities.map((city, index) => (
                <div
                  key={city.city}
                  className="flex items-center justify-between"
                >
                  <span className="text-sm">
                    {index + 1}. {city.city}
                  </span>
                  <span className="font-bold">{city.count}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-gray-500">No location data yet</p>
          )}
        </Card>
      </div>

      {/* ROI Calculator */}
      <Card className="p-6">
        <h2 className="mb-4 text-xl font-bold">ROI Estimate</h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <div>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Total Taps
            </p>
            <p className="text-2xl font-bold">{stats.totalTaps}</p>
          </div>
          <div>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Conversions
            </p>
            <p className="text-2xl font-bold">{stats.conversions}</p>
          </div>
          <div>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Est. Revenue (@ $200/job)
            </p>
            <p className="text-2xl font-bold text-green-600">
              ${stats.conversions * 200}
            </p>
          </div>
        </div>
        <p className="mt-4 text-xs text-gray-500">
          * Assuming average job value of $200. Track actual conversions in your
          leads dashboard.
        </p>
      </Card>
    </div>
  )
}
