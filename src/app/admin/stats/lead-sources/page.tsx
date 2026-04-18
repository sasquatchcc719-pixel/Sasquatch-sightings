'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

type LeadSourceStat = {
  lead_source: string
  booking_count: number
  completed_count: number
  total_revenue: number
  avg_ticket: number
  percentage: number
}

type StatsResponse = {
  sources: LeadSourceStat[]
  total_bookings: number
  total_revenue: number
  date_range: { start: string; end: string }
}

export default function LeadSourcesPage() {
  const [stats, setStats] = useState<StatsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [dateRange, setDateRange] = useState('30')

  useEffect(() => {
    loadStats()
  }, [dateRange])

  async function loadStats() {
    setLoading(true)
    try {
      const today = new Date()
      const startDate = new Date()

      if (dateRange === '7') {
        startDate.setDate(today.getDate() - 7)
      } else if (dateRange === '30') {
        startDate.setDate(today.getDate() - 30)
      } else if (dateRange === '90') {
        startDate.setDate(today.getDate() - 90)
      } else if (dateRange === 'ytd') {
        startDate.setMonth(0, 1) // Jan 1 of current year
      } else {
        startDate.setFullYear(2020) // All time
      }

      const params = new URLSearchParams({
        start_date: startDate.toISOString().split('T')[0],
        end_date: today.toISOString().split('T')[0],
      })

      const res = await fetch(`/api/admin/stats/lead-sources?${params}`)
      const data = await res.json()
      setStats(data)
    } catch (error) {
      console.error('Failed to load stats:', error)
    } finally {
      setLoading(false)
    }
  }

  const formatCurrency = (n: number) =>
    new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(n)

  return (
    <div className="container mx-auto space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Lead Source Analytics</h1>
          <p className="text-muted-foreground">
            Track where your bookings are coming from
          </p>
        </div>

        <Select value={dateRange} onValueChange={setDateRange}>
          <SelectTrigger className="w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="7">Last 7 Days</SelectItem>
            <SelectItem value="30">Last 30 Days</SelectItem>
            <SelectItem value="90">Last 90 Days</SelectItem>
            <SelectItem value="ytd">Year to Date</SelectItem>
            <SelectItem value="all">All Time</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {loading ? (
        <div className="flex h-64 items-center justify-center">
          <p className="text-muted-foreground">Loading...</p>
        </div>
      ) : !stats ? (
        <div className="flex h-64 items-center justify-center">
          <p className="text-muted-foreground">No data available</p>
        </div>
      ) : (
        <>
          {/* Summary Cards */}
          <div className="grid gap-4 md:grid-cols-3">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-muted-foreground text-sm font-medium">
                  Total Bookings
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold">{stats.total_bookings}</div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-muted-foreground text-sm font-medium">
                  Total Revenue
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold">
                  {formatCurrency(stats.total_revenue)}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-muted-foreground text-sm font-medium">
                  Top Source
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold">
                  {stats.sources[0]?.lead_source || 'N/A'}
                </div>
                <p className="text-muted-foreground text-sm">
                  {stats.sources[0]?.booking_count || 0} bookings
                </p>
              </CardContent>
            </Card>
          </div>

          {/* Lead Sources Table */}
          <Card>
            <CardHeader>
              <CardTitle>Lead Source Breakdown</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b">
                      <th className="pb-3 text-left font-medium">Source</th>
                      <th className="pb-3 text-right font-medium">Bookings</th>
                      <th className="pb-3 text-right font-medium">
                        % of Total
                      </th>
                      <th className="pb-3 text-right font-medium">Revenue</th>
                      <th className="pb-3 text-right font-medium">
                        Avg Ticket
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.sources.map((source) => (
                      <tr key={source.lead_source} className="border-b">
                        <td className="py-3 font-medium">
                          {source.lead_source}
                        </td>
                        <td className="py-3 text-right">
                          {source.booking_count}
                        </td>
                        <td className="py-3 text-right">
                          {source.percentage}%
                        </td>
                        <td className="py-3 text-right">
                          {formatCurrency(source.total_revenue)}
                        </td>
                        <td className="py-3 text-right">
                          {formatCurrency(source.avg_ticket)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          {/* Simple Bar Chart */}
          <Card>
            <CardHeader>
              <CardTitle>Bookings by Source</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {stats.sources.map((source) => (
                  <div key={source.lead_source}>
                    <div className="mb-1 flex items-center justify-between text-sm">
                      <span className="font-medium">{source.lead_source}</span>
                      <span className="text-muted-foreground">
                        {source.booking_count} ({source.percentage}%)
                      </span>
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded-full bg-gray-200">
                      <div
                        className="h-full bg-green-600"
                        style={{ width: `${source.percentage}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}
