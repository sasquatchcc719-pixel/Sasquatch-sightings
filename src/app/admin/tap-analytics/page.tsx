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
  Send,
  X,
  AlertCircle,
  CheckCircle,
  Clock,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'

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

type Message = {
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp: string
}

type Conversation = {
  id: string
  phone_number: string
  source: string | null
  lead_id: string | null
  messages: Message[]
  ai_enabled: boolean
  status: 'active' | 'completed' | 'escalated'
  created_at: string
  updated_at: string
  lead?: {
    id: string
    name: string
    source: string
    status: string
  } | null
}

export default function TapAnalyticsPage() {
  const [stats, setStats] = useState<TapStats | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [timeframe, setTimeframe] = useState<
    'today' | 'week' | 'month' | 'all'
  >('all')

  // Conversations state
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [selectedConvo, setSelectedConvo] = useState<Conversation | null>(null)
  const [filterStatus, setFilterStatus] = useState<
    'all' | 'active' | 'escalated'
  >('all')
  const [replyText, setReplyText] = useState('')
  const [sending, setSending] = useState(false)

  useEffect(() => {
    fetchStats()
    fetchConversations()
  }, [timeframe])

  const fetchConversations = async () => {
    try {
      const supabase = createClient()
      const { data, error } = await supabase
        .from('conversations')
        .select('*, lead:leads(id, name, source, status)')
        .eq('source', 'Business Card')
        .order('updated_at', { ascending: false })

      if (error) throw error
      setConversations((data as Conversation[]) || [])
    } catch (error) {
      console.error('Failed to fetch conversations:', error)
    }
  }

  const handleSendReply = async () => {
    if (!selectedConvo || !replyText.trim()) return

    setSending(true)
    try {
      const response = await fetch(
        `/api/conversations/${selectedConvo.id}/reply`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            conversationId: selectedConvo.id,
            message: replyText.trim(),
          }),
        },
      )

      if (response.ok) {
        setReplyText('')
        fetchConversations()
      } else {
        alert('Failed to send message')
      }
    } catch (error) {
      console.error('Send error:', error)
      alert('Failed to send message')
    } finally {
      setSending(false)
    }
  }

  const handleUpdateStatus = async (
    conversationId: string,
    newStatus: string,
  ) => {
    try {
      const response = await fetch(`/api/conversations/${conversationId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      })

      if (response.ok) {
        fetchConversations()
        if (selectedConvo?.id === conversationId) {
          setSelectedConvo({
            ...selectedConvo,
            status: newStatus as Conversation['status'],
          })
        }
      } else {
        alert('Failed to update status')
      }
    } catch (error) {
      console.error('Update error:', error)
      alert('Failed to update status')
    }
  }

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'active':
        return (
          <Badge variant="secondary" className="bg-blue-100 text-blue-800">
            <MessageSquare className="mr-1 h-3 w-3" />
            Active
          </Badge>
        )
      case 'completed':
        return (
          <Badge variant="secondary" className="bg-green-100 text-green-800">
            <CheckCircle className="mr-1 h-3 w-3" />
            Completed
          </Badge>
        )
      case 'escalated':
        return (
          <Badge variant="secondary" className="bg-red-100 text-red-800">
            <AlertCircle className="mr-1 h-3 w-3" />
            Escalated
          </Badge>
        )
      default:
        return <Badge>{status}</Badge>
    }
  }

  const formatTime = (timestamp: string) => {
    try {
      return new Date(timestamp).toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        timeZone: 'America/Denver',
      })
    } catch {
      return timestamp
    }
  }

  const filteredConversations =
    filterStatus === 'all'
      ? conversations
      : conversations.filter((c) => c.status === filterStatus)

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

      // Fetch taps - only business card taps (no vendor attached)
      const { data: taps, error: tapsError } = await supabase
        .from('nfc_card_taps')
        .select('*')
        .is('partner_id', null)
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
        <h1 className="text-2xl font-bold sm:text-3xl">Business Cards</h1>
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
              Business Card Landing Page
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

      {/* Business Card Conversations */}
      <Card className="p-4 sm:p-6">
        <h2 className="mb-3 text-lg font-bold sm:mb-4 sm:text-xl">
          Business Card Conversations
        </h2>
        <p className="mb-4 text-sm text-gray-600 dark:text-gray-400">
          SMS conversations from people who tapped your personal business cards.
        </p>

        {/* Filter buttons */}
        <div className="mb-4 grid grid-cols-3 gap-2">
          <button
            onClick={() => setFilterStatus('all')}
            className={`rounded-lg border p-2 text-center transition-all ${
              filterStatus === 'all'
                ? 'bg-blue-50 ring-2 ring-blue-500 dark:bg-blue-950'
                : 'hover:bg-gray-50 dark:hover:bg-gray-800'
            }`}
          >
            <div className="text-lg font-bold">{conversations.length}</div>
            <div className="text-xs text-gray-500">Total</div>
          </button>
          <button
            onClick={() => setFilterStatus('active')}
            className={`rounded-lg border p-2 text-center transition-all ${
              filterStatus === 'active'
                ? 'bg-blue-50 ring-2 ring-blue-500 dark:bg-blue-950'
                : 'hover:bg-gray-50 dark:hover:bg-gray-800'
            }`}
          >
            <div className="text-lg font-bold">
              {conversations.filter((c) => c.status === 'active').length}
            </div>
            <div className="text-xs text-gray-500">Active</div>
          </button>
          <button
            onClick={() => setFilterStatus('escalated')}
            className={`rounded-lg border p-2 text-center transition-all ${
              filterStatus === 'escalated'
                ? 'bg-blue-50 ring-2 ring-blue-500 dark:bg-blue-950'
                : 'hover:bg-gray-50 dark:hover:bg-gray-800'
            }`}
          >
            <div className="text-lg font-bold">
              {conversations.filter((c) => c.status === 'escalated').length}
            </div>
            <div className="text-xs text-gray-500">Escalated</div>
          </button>
        </div>

        {/* Conversations list */}
        {filteredConversations.length === 0 ? (
          <div className="py-8 text-center text-gray-500">
            {filterStatus === 'all'
              ? "No business card conversations yet. When someone texts from your card, they'll appear here."
              : `No ${filterStatus} conversations.`}
          </div>
        ) : (
          <div className="space-y-2">
            {filteredConversations.map((convo) => {
              const lastMessage = convo.messages[convo.messages.length - 1]
              return (
                <div
                  key={convo.id}
                  onClick={() => setSelectedConvo(convo)}
                  className="cursor-pointer rounded-lg border p-3 transition-colors hover:bg-gray-50 dark:hover:bg-gray-800"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="mb-1 flex flex-wrap items-center gap-2">
                        <a
                          href={`tel:${convo.phone_number}`}
                          className="text-sm font-medium text-blue-500 hover:underline"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {convo.phone_number}
                        </a>
                        {getStatusBadge(convo.status)}
                      </div>
                      {convo.lead?.name && (
                        <div className="mb-1 text-xs text-gray-500">
                          {convo.lead.name}
                        </div>
                      )}
                      {lastMessage && (
                        <div className="line-clamp-2 text-xs text-gray-500">
                          {lastMessage.role === 'user' ? '💬 ' : '🤖 '}
                          {lastMessage.content}
                        </div>
                      )}
                    </div>
                    <div className="text-right text-xs text-gray-400">
                      <div>{formatTime(convo.updated_at)}</div>
                      <div>{convo.messages.length} msgs</div>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </Card>

      {/* Conversation Detail Modal */}
      {selectedConvo && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setSelectedConvo(null)}
        >
          <div
            className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl bg-white shadow-xl dark:bg-gray-900"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="border-b p-4">
              <div className="mb-2 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <a
                    href={`tel:${selectedConvo.phone_number}`}
                    className="text-lg font-semibold text-blue-500 hover:underline"
                  >
                    {selectedConvo.phone_number}
                  </a>
                  {getStatusBadge(selectedConvo.status)}
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setSelectedConvo(null)}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
              {selectedConvo.lead && (
                <div className="mb-2 text-sm text-gray-500">
                  Lead: {selectedConvo.lead.name}
                </div>
              )}
              <div className="mb-3 text-xs text-gray-400">
                Started: {formatTime(selectedConvo.created_at)} •{' '}
                {selectedConvo.messages.length} messages
              </div>

              {/* Action Buttons */}
              <div className="flex gap-2">
                {selectedConvo.status !== 'completed' && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      handleUpdateStatus(selectedConvo.id, 'completed')
                    }
                  >
                    <CheckCircle className="mr-1 h-3 w-3" />
                    Complete
                  </Button>
                )}
                {selectedConvo.status === 'completed' && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      handleUpdateStatus(selectedConvo.id, 'active')
                    }
                  >
                    Reopen
                  </Button>
                )}
                {selectedConvo.status !== 'escalated' && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      handleUpdateStatus(selectedConvo.id, 'escalated')
                    }
                  >
                    <AlertCircle className="mr-1 h-3 w-3" />
                    Flag
                  </Button>
                )}
              </div>
            </div>

            {/* Messages */}
            <div className="flex-1 space-y-3 overflow-y-auto p-4">
              {selectedConvo.messages.map((msg, idx) => (
                <div
                  key={idx}
                  className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`max-w-[80%] rounded-lg p-3 ${
                      msg.role === 'user'
                        ? 'bg-blue-600 text-white'
                        : msg.role === 'system'
                          ? 'bg-red-100 text-xs text-red-800'
                          : 'bg-gray-100 dark:bg-gray-800'
                    }`}
                  >
                    <div className="text-sm whitespace-pre-wrap">
                      {msg.content}
                    </div>
                    <div
                      className={`mt-1 text-xs ${
                        msg.role === 'user' ? 'text-blue-100' : 'text-gray-400'
                      }`}
                    >
                      {formatTime(msg.timestamp)}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Reply Box */}
            <div className="border-t p-4">
              <div className="flex gap-2">
                <Textarea
                  value={replyText}
                  onChange={(e) => setReplyText(e.target.value)}
                  placeholder="Type your reply..."
                  className="min-h-[80px] flex-1"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                      handleSendReply()
                    }
                  }}
                />
                <Button
                  onClick={handleSendReply}
                  disabled={!replyText.trim() || sending}
                  className="self-end"
                >
                  {sending ? (
                    'Sending...'
                  ) : (
                    <>
                      <Send className="mr-1 h-4 w-4" />
                      Send
                    </>
                  )}
                </Button>
              </div>
              <p className="mt-2 text-xs text-gray-400">
                Cmd/Ctrl + Enter to send
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
