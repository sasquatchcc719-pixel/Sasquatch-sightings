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
  bookingClicks: number
  callClicks: number
  textClicks: number
  formSubmits: number
  saveContactClicks: number
  shareClicks: number
  todayTaps: number
  weekTaps: number
  monthTaps: number
  topCities: { city: string; count: number }[]
  deviceBreakdown: { mobile: number; tablet: number; desktop: number }
}

type StationHealth = {
  partnerId: string
  partnerName: string
  locationType: string | null
  sasquatchLastTap: string | null
  sasquatchTotalTaps: number
  sasquatchStatus: 'active' | 'warning' | 'inactive' | 'never'
  reviewLastTap: string | null
  reviewTotalTaps: number
  reviewStatus: 'active' | 'warning' | 'inactive' | 'never' | 'not_configured'
  hasGoogleReviewUrl: boolean
}

// Helper to calculate station status based on last tap
function getStationStatus(
  lastTap: string | null,
  totalTaps: number,
): 'active' | 'warning' | 'inactive' | 'never' {
  if (!lastTap || totalTaps === 0) return 'never'

  const daysSinceLastTap = Math.floor(
    (Date.now() - new Date(lastTap).getTime()) / (1000 * 60 * 60 * 24),
  )

  if (daysSinceLastTap <= 7) return 'active'
  if (daysSinceLastTap <= 14) return 'warning'
  return 'inactive'
}

// Helper to format relative time
function formatRelativeTime(dateString: string | null): string {
  if (!dateString) return 'Never'

  const date = new Date(dateString)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60))

  if (diffHours < 1) return 'Just now'
  if (diffHours < 24) return `${diffHours}h ago`
  if (diffDays === 1) return 'Yesterday'
  if (diffDays < 7) return `${diffDays} days ago`
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`
  return `${Math.floor(diffDays / 30)} months ago`
}

export default function TapAnalyticsPage() {
  const [stats, setStats] = useState<TapStats | null>(null)
  const [stationHealth, setStationHealth] = useState<StationHealth[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [timeframe, setTimeframe] = useState<
    'today' | 'week' | 'month' | 'all'
  >('all')

  useEffect(() => {
    fetchStats()
    fetchStationHealth()
  }, [timeframe])

  const fetchStationHealth = async () => {
    try {
      const supabase = createClient()

      // Fetch location partners with their tap stats
      const { data: partners, error: partnersError } = await supabase
        .from('partners')
        .select(
          'id, location_name, company_name, location_type, total_taps, last_sasquatch_tap_at, last_review_tap_at, google_review_url',
        )
        .eq('partner_type', 'location')
        .order('total_taps', { ascending: false })

      if (partnersError) {
        console.error('Failed to fetch partners:', partnersError)
        return
      }

      // Fetch review station tap counts per partner
      const { data: reviewTapCounts, error: reviewError } = await supabase
        .from('review_station_taps')
        .select('partner_id')

      if (reviewError) {
        console.error('Failed to fetch review taps:', reviewError)
      }

      // Count review taps per partner
      const reviewCountMap: Record<string, number> = {}
      if (reviewTapCounts) {
        reviewTapCounts.forEach((tap) => {
          if (tap.partner_id) {
            reviewCountMap[tap.partner_id] =
              (reviewCountMap[tap.partner_id] || 0) + 1
          }
        })
      }

      // Build station health data
      const healthData: StationHealth[] = (partners || []).map((partner) => {
        const sasquatchTotalTaps = partner.total_taps || 0
        const reviewTotalTaps = reviewCountMap[partner.id] || 0
        const hasGoogleReviewUrl = !!partner.google_review_url

        return {
          partnerId: partner.id,
          partnerName:
            partner.location_name || partner.company_name || 'Unknown',
          locationType: partner.location_type,
          sasquatchLastTap: partner.last_sasquatch_tap_at,
          sasquatchTotalTaps,
          sasquatchStatus: getStationStatus(
            partner.last_sasquatch_tap_at,
            sasquatchTotalTaps,
          ),
          reviewLastTap: partner.last_review_tap_at,
          reviewTotalTaps,
          reviewStatus: hasGoogleReviewUrl
            ? getStationStatus(partner.last_review_tap_at, reviewTotalTaps)
            : 'not_configured',
          hasGoogleReviewUrl,
        }
      })

      setStationHealth(healthData)
    } catch (error) {
      console.error('Failed to fetch station health:', error)
    }
  }

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

      const bookingClicks = clickData.filter(
        (c) => c.button_type === 'booking_page',
      ).length
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
      const shareClicks = clickData.filter(
        (c) => c.button_type === 'share',
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
        bookingClicks,
        callClicks,
        textClicks,
        formSubmits,
        saveContactClicks,
        shareClicks,
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
    <div className="mx-auto max-w-6xl space-y-4 p-4 sm:space-y-6 sm:p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-bold sm:text-3xl">NFC Card Analytics</h1>
        <div className="flex flex-wrap gap-2">
          {(['today', 'week', 'month', 'all'] as const).map((tf) => (
            <button
              key={tf}
              onClick={() => setTimeframe(tf)}
              className={`rounded px-3 py-1.5 text-xs sm:text-sm ${
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
                    : 'All'}
            </button>
          ))}
        </div>
      </div>

      {/* Landing Page Quick Links */}
      <Card className="border-blue-500 bg-blue-50 p-3 sm:p-4 dark:bg-blue-950">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-semibold text-blue-900 dark:text-blue-100">
              NFC Card Landing Page
            </p>
            <p className="text-xs text-blue-700 dark:text-blue-300">/tap</p>
          </div>
          <div className="flex gap-2">
            <a
              href="/tap"
              target="_blank"
              rel="noopener noreferrer"
              className="rounded bg-blue-600 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-700 sm:px-4 sm:text-sm"
            >
              View Page
            </a>
            <button
              onClick={handleCopyURL}
              className="rounded bg-green-600 px-3 py-2 text-xs font-semibold text-white hover:bg-green-700 sm:px-4 sm:text-sm"
            >
              Copy URL
            </button>
          </div>
        </div>
      </Card>

      {/* Overview Stats */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <Card className="p-3 sm:p-4">
          <div className="flex items-center gap-2">
            <Users className="h-4 w-4 text-blue-500 sm:h-5 sm:w-5" />
            <p className="text-xs text-gray-600 sm:text-sm dark:text-gray-400">
              Taps
            </p>
          </div>
          <p className="mt-1 text-2xl font-bold sm:mt-2 sm:text-3xl">
            {stats.totalTaps}
          </p>
          <p className="text-xs text-gray-500">{stats.uniqueTaps} unique</p>
        </Card>

        <Card className="p-3 sm:p-4">
          <div className="flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-green-500 sm:h-5 sm:w-5" />
            <p className="text-xs text-gray-600 sm:text-sm dark:text-gray-400">
              Conv.
            </p>
          </div>
          <p className="mt-1 text-2xl font-bold sm:mt-2 sm:text-3xl">
            {stats.conversions}
          </p>
          <p className="text-xs text-gray-500">
            {stats.conversionRate.toFixed(1)}%
          </p>
        </Card>

        <Card className="p-3 sm:p-4">
          <div className="flex items-center gap-2">
            <Calendar className="h-4 w-4 text-purple-500 sm:h-5 sm:w-5" />
            <p className="text-xs text-gray-600 sm:text-sm dark:text-gray-400">
              Week
            </p>
          </div>
          <p className="mt-1 text-2xl font-bold sm:mt-2 sm:text-3xl">
            {stats.weekTaps}
          </p>
          <p className="text-xs text-gray-500">{stats.todayTaps} today</p>
        </Card>

        <Card className="p-3 sm:p-4">
          <div className="flex items-center gap-2">
            <Phone className="h-4 w-4 text-orange-500 sm:h-5 sm:w-5" />
            <p className="text-xs text-gray-600 sm:text-sm dark:text-gray-400">
              Calls
            </p>
          </div>
          <p className="mt-1 text-2xl font-bold sm:mt-2 sm:text-3xl">
            {stats.callClicks}
          </p>
          <p className="text-xs text-gray-500">button clicks</p>
        </Card>
      </div>

      {/* Button Engagement */}
      <Card className="p-4 sm:p-6">
        <h2 className="mb-3 text-lg font-bold sm:mb-4 sm:text-xl">
          Button Engagement
        </h2>
        <div className="grid grid-cols-3 gap-3 sm:gap-4 md:grid-cols-6">
          <div className="text-center">
            <div className="mx-auto mb-1 flex h-8 w-8 items-center justify-center rounded-full bg-green-100 sm:mb-2 sm:h-12 sm:w-12 dark:bg-green-900">
              <span className="text-lg sm:text-2xl">📅</span>
            </div>
            <p className="text-lg font-bold sm:text-2xl">
              {stats.bookingClicks}
            </p>
            <p className="text-xs text-gray-600 dark:text-gray-400">Book</p>
          </div>
          <div className="text-center">
            <Phone className="mx-auto mb-1 h-6 w-6 text-green-500 sm:mb-2 sm:h-8 sm:w-8" />
            <p className="text-lg font-bold sm:text-2xl">{stats.callClicks}</p>
            <p className="text-xs text-gray-600 dark:text-gray-400">Calls</p>
          </div>
          <div className="text-center">
            <MessageSquare className="mx-auto mb-1 h-6 w-6 text-blue-500 sm:mb-2 sm:h-8 sm:w-8" />
            <p className="text-lg font-bold sm:text-2xl">{stats.textClicks}</p>
            <p className="text-xs text-gray-600 dark:text-gray-400">Texts</p>
          </div>
          <div className="text-center">
            <Download className="mx-auto mb-1 h-6 w-6 text-orange-500 sm:mb-2 sm:h-8 sm:w-8" />
            <p className="text-lg font-bold sm:text-2xl">
              {stats.saveContactClicks}
            </p>
            <p className="text-xs text-gray-600 dark:text-gray-400">Save</p>
          </div>
          <div className="text-center">
            <div className="mx-auto mb-1 flex h-8 w-8 items-center justify-center rounded-full bg-blue-100 sm:mb-2 sm:h-12 sm:w-12 dark:bg-blue-900">
              <span className="text-lg sm:text-2xl">🔗</span>
            </div>
            <p className="text-lg font-bold sm:text-2xl">{stats.shareClicks}</p>
            <p className="text-xs text-gray-600 dark:text-gray-400">Share</p>
          </div>
          <div className="text-center">
            <FileText className="mx-auto mb-1 h-6 w-6 text-purple-500 sm:mb-2 sm:h-8 sm:w-8" />
            <p className="text-lg font-bold sm:text-2xl">{stats.formSubmits}</p>
            <p className="text-xs text-gray-600 dark:text-gray-400">Forms</p>
          </div>
        </div>
      </Card>

      {/* Top Cities */}
      <Card className="p-4 sm:p-6">
        <h2 className="mb-3 text-lg font-bold sm:mb-4 sm:text-xl">
          Top Cities
        </h2>
        {stats.topCities.length > 0 ? (
          <div className="space-y-2">
            {stats.topCities.map((city, index) => (
              <div
                key={city.city}
                className="flex items-center justify-between"
              >
                <span className="text-xs sm:text-sm">
                  {index + 1}. {city.city}
                </span>
                <span className="text-sm font-bold">{city.count}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-gray-500 sm:text-sm">
            No location data yet
          </p>
        )}
      </Card>

      {/* Station Health */}
      <Card className="p-4 sm:p-6">
        <h2 className="mb-3 text-lg font-bold sm:mb-4 sm:text-xl">
          Station Health
        </h2>
        <p className="mb-4 text-sm text-gray-600 dark:text-gray-400">
          Monitor activity for both Sasquatch lead gen stations and partner
          Google review stations.
        </p>

        {stationHealth.length === 0 ? (
          <p className="text-sm text-gray-500">No location partners found.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left">
                  <th className="pb-2 font-semibold">Partner</th>
                  <th className="pb-2 text-center font-semibold">
                    Sasquatch Station
                  </th>
                  <th className="pb-2 text-center font-semibold">
                    Google Review Station
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {stationHealth.map((station) => (
                  <tr key={station.partnerId}>
                    <td className="py-3">
                      <div className="font-medium">{station.partnerName}</div>
                      {station.locationType && (
                        <div className="text-xs text-gray-500 capitalize">
                          {station.locationType}
                        </div>
                      )}
                    </td>
                    <td className="py-3 text-center">
                      <div className="flex flex-col items-center gap-1">
                        <span
                          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
                            station.sasquatchStatus === 'active'
                              ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
                              : station.sasquatchStatus === 'warning'
                                ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200'
                                : station.sasquatchStatus === 'inactive'
                                  ? 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200'
                                  : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400'
                          }`}
                        >
                          {station.sasquatchStatus === 'active' && '🟢'}
                          {station.sasquatchStatus === 'warning' && '🟡'}
                          {station.sasquatchStatus === 'inactive' && '🔴'}
                          {station.sasquatchStatus === 'never' && '⚪'}
                          {station.sasquatchStatus === 'active' && 'Active'}
                          {station.sasquatchStatus === 'warning' && 'Check In'}
                          {station.sasquatchStatus === 'inactive' && 'Inactive'}
                          {station.sasquatchStatus === 'never' && 'No Taps'}
                        </span>
                        <span className="text-xs text-gray-500">
                          {formatRelativeTime(station.sasquatchLastTap)} ·{' '}
                          {station.sasquatchTotalTaps} total
                        </span>
                      </div>
                    </td>
                    <td className="py-3 text-center">
                      <div className="flex flex-col items-center gap-1">
                        {station.reviewStatus === 'not_configured' ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-500 dark:bg-gray-800 dark:text-gray-400">
                            ➖ Not Set Up
                          </span>
                        ) : (
                          <>
                            <span
                              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
                                station.reviewStatus === 'active'
                                  ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
                                  : station.reviewStatus === 'warning'
                                    ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200'
                                    : station.reviewStatus === 'inactive'
                                      ? 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200'
                                      : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400'
                              }`}
                            >
                              {station.reviewStatus === 'active' && '🟢'}
                              {station.reviewStatus === 'warning' && '🟡'}
                              {station.reviewStatus === 'inactive' && '🔴'}
                              {station.reviewStatus === 'never' && '⚪'}
                              {station.reviewStatus === 'active' && 'Active'}
                              {station.reviewStatus === 'warning' && 'Check In'}
                              {station.reviewStatus === 'inactive' &&
                                'Inactive'}
                              {station.reviewStatus === 'never' && 'No Taps'}
                            </span>
                            <span className="text-xs text-gray-500">
                              {formatRelativeTime(station.reviewLastTap)} ·{' '}
                              {station.reviewTotalTaps} total
                            </span>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="mt-4 flex flex-wrap gap-3 text-xs text-gray-500">
          <span className="flex items-center gap-1">
            🟢 Active (taps within 7 days)
          </span>
          <span className="flex items-center gap-1">
            🟡 Check In (7-14 days)
          </span>
          <span className="flex items-center gap-1">
            🔴 Inactive (14+ days)
          </span>
          <span className="flex items-center gap-1">⚪ Never tapped</span>
        </div>
      </Card>
    </div>
  )
}
