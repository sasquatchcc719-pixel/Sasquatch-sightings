'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Trophy,
  Download,
  Search,
  MapPin,
  Mail,
  Calendar,
  Loader2,
  Trash2,
  MessageSquare,
  Send,
  X,
  AlertCircle,
  CheckCircle,
} from 'lucide-react'
import Link from 'next/link'

type Sighting = {
  id: string
  image_url: string
  full_name: string
  phone_number: string
  email: string
  zip_code: string | null
  coupon_code: string
  contest_eligible: boolean
  coupon_redeemed: boolean
  share_verified: boolean | null
  social_platform: string | null
  social_link: string | null
  gps_lat: number | null
  gps_lng: number | null
  created_at: string
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

export default function SightingsAdminPage() {
  // View toggle: 'entries' or 'conversations'
  const [activeView, setActiveView] = useState<'entries' | 'conversations'>(
    'entries',
  )

  // Sightings state
  const [sightings, setSightings] = useState<Sighting[]>([])
  const [filteredSightings, setFilteredSightings] = useState<Sighting[]>([])
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')
  const [filter, setFilter] = useState<
    'all' | 'eligible' | 'coupon-only' | 'shared'
  >('all')
  const [updatingId, setUpdatingId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  // Conversations state
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [selectedConvo, setSelectedConvo] = useState<Conversation | null>(null)
  const [convoFilter, setConvoFilter] = useState<
    'all' | 'active' | 'escalated'
  >('all')
  const [replyText, setReplyText] = useState('')
  const [sending, setSending] = useState(false)

  // Fetch sightings
  useEffect(() => {
    async function fetchSightings() {
      const supabase = createClient()
      const { data, error } = await supabase
        .from('sightings')
        .select('*')
        .order('created_at', { ascending: false })

      if (error) {
        console.error('Error fetching sightings:', error)
      } else {
        setSightings(data || [])
        setFilteredSightings(data || [])
      }
      setLoading(false)
    }

    fetchSightings()
    fetchConversations()
  }, [])

  // Fetch contest conversations
  const fetchConversations = async () => {
    try {
      const supabase = createClient()
      const { data, error } = await supabase
        .from('conversations')
        .select('*, lead:leads(id, name, source, status)')
        .eq('source', 'Contest')
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
    convoFilter === 'all'
      ? conversations
      : conversations.filter((c) => c.status === convoFilter)

  // Apply filters and search
  useEffect(() => {
    let filtered = sightings

    // Apply filter
    if (filter === 'eligible') {
      filtered = filtered.filter((s) => s.contest_eligible)
    } else if (filter === 'coupon-only') {
      filtered = filtered.filter((s) => !s.contest_eligible)
    } else if (filter === 'shared') {
      filtered = filtered.filter((s) => s.share_verified)
    }

    // Apply search
    if (searchTerm) {
      const term = searchTerm.toLowerCase()
      filtered = filtered.filter(
        (s) =>
          s.full_name.toLowerCase().includes(term) ||
          s.phone_number.toLowerCase().includes(term) ||
          s.email.toLowerCase().includes(term) ||
          s.coupon_code.toLowerCase().includes(term),
      )
    }

    setFilteredSightings(filtered)
  }, [sightings, filter, searchTerm])

  // Handle coupon redeemed toggle
  const handleToggleRedeemed = async (id: string, currentStatus: boolean) => {
    setUpdatingId(id)
    try {
      const response = await fetch(`/api/sightings/${id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ coupon_redeemed: !currentStatus }),
      })

      if (response.ok) {
        // Update local state
        setSightings((prev) =>
          prev.map((s) =>
            s.id === id ? { ...s, coupon_redeemed: !currentStatus } : s,
          ),
        )
      }
    } catch (error) {
      console.error('Error updating coupon status:', error)
    } finally {
      setUpdatingId(null)
    }
  }

  // Handle delete sighting
  const handleDelete = async (id: string, name: string) => {
    if (
      !confirm(
        `Are you sure you want to delete the entry from ${name}? This cannot be undone.`,
      )
    ) {
      return
    }

    setDeletingId(id)
    try {
      const response = await fetch(`/api/sightings/${id}/delete`, {
        method: 'DELETE',
      })

      if (response.ok) {
        // Remove from local state
        setSightings((prev) => prev.filter((s) => s.id !== id))
      } else {
        const data = await response.json()
        alert(`Failed to delete entry: ${data.error || 'Unknown error'}`)
      }
    } catch (error) {
      console.error('Error deleting sighting:', error)
      alert('Failed to delete entry. Please try again.')
    } finally {
      setDeletingId(null)
    }
  }

  // Export to CSV
  const handleExportCSV = () => {
    const csvContent = [
      [
        'Full Name',
        'Phone Number',
        'Email',
        'Zip Code',
        'Coupon Code',
        'Contest Eligible',
        'Shared',
        'Coupon Redeemed',
        'Date Submitted',
      ],
      ...filteredSightings.map((s) => [
        s.full_name,
        s.phone_number,
        s.email,
        s.zip_code || '',
        s.coupon_code,
        s.contest_eligible ? 'Yes' : 'No',
        s.share_verified ? 'Yes' : 'No',
        s.coupon_redeemed ? 'Yes' : 'No',
        new Date(s.created_at).toLocaleDateString(),
      ]),
    ]
      .map((row) => row.join(','))
      .join('\n')

    const blob = new Blob([csvContent], { type: 'text/csv' })
    const url = window.URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `sightings-${new Date().toISOString().split('T')[0]}.csv`
    a.click()
    window.URL.revokeObjectURL(url)
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    )
  }

  return (
    <div className="w-full space-y-4 sm:space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold sm:text-3xl">
            <Trophy className="h-6 w-6 sm:h-8 sm:w-8" />
            Contest
          </h1>
          <p className="text-muted-foreground text-sm">
            Sasquatch sighting submissions & conversations
          </p>
        </div>
        <Button
          onClick={handleExportCSV}
          variant="outline"
          size="sm"
          className="sm:size-default"
        >
          <Download className="mr-1 h-4 w-4 sm:mr-2" />
          <span className="hidden sm:inline">Export </span>CSV
        </Button>
      </div>

      {/* View Toggle */}
      <div className="flex gap-2 border-b pb-2">
        <Button
          variant={activeView === 'entries' ? 'default' : 'ghost'}
          size="sm"
          onClick={() => setActiveView('entries')}
          className="gap-2"
        >
          <Trophy className="h-4 w-4" />
          Entries ({sightings.length})
        </Button>
        <Button
          variant={activeView === 'conversations' ? 'default' : 'ghost'}
          size="sm"
          onClick={() => setActiveView('conversations')}
          className="gap-2"
        >
          <MessageSquare className="h-4 w-4" />
          Conversations ({conversations.length})
        </Button>
      </div>

      {activeView === 'entries' && (
        <>
          {/* Filters and Search */}
          <div className="space-y-3">
            {/* Search */}
            <div className="relative">
              <Search className="text-muted-foreground absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
              <Input
                placeholder="Search by name, phone, email, or coupon..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-9"
              />
            </div>

            {/* Filter Buttons */}
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant={filter === 'all' ? 'default' : 'outline'}
                onClick={() => setFilter('all')}
                className="text-xs sm:text-sm"
              >
                All ({sightings.length})
              </Button>
              <Button
                size="sm"
                variant={filter === 'eligible' ? 'default' : 'outline'}
                onClick={() => setFilter('eligible')}
                className="text-xs sm:text-sm"
              >
                <span className="hidden sm:inline">Contest </span>Eligible (
                {sightings.filter((s) => s.contest_eligible).length})
              </Button>
              <Button
                size="sm"
                variant={filter === 'coupon-only' ? 'default' : 'outline'}
                onClick={() => setFilter('coupon-only')}
                className="text-xs sm:text-sm"
              >
                Coupon Only (
                {sightings.filter((s) => !s.contest_eligible).length})
              </Button>
              <Button
                size="sm"
                variant={filter === 'shared' ? 'default' : 'outline'}
                onClick={() => setFilter('shared')}
                className={`text-xs sm:text-sm ${filter === 'shared' ? 'bg-blue-600 hover:bg-blue-700' : ''}`}
              >
                ✓ Shared ({sightings.filter((s) => s.share_verified).length})
              </Button>
            </div>
          </div>

          {/* Results Count */}
          <p className="text-muted-foreground text-sm">
            Showing {filteredSightings.length}{' '}
            {filteredSightings.length === 1 ? 'entry' : 'entries'}
          </p>
        </>
      )}

      {/* Sightings List */}
      {activeView === 'entries' && (
        <div className="space-y-3">
          {filteredSightings.length === 0 ? (
            <Card className="text-muted-foreground p-8 text-center">
              No entries found
            </Card>
          ) : (
            filteredSightings.map((sighting) => (
              <Card key={sighting.id} className="overflow-hidden">
                <div className="flex gap-3 p-3 sm:gap-4 sm:p-4">
                  {/* Image Thumbnail */}
                  <div className="shrink-0">
                    <a
                      href={sighting.image_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block"
                    >
                      <img
                        src={sighting.image_url}
                        alt="Sighting"
                        className="h-24 w-24 rounded-md object-cover transition-opacity hover:opacity-80 sm:h-32 sm:w-32"
                      />
                    </a>
                  </div>

                  {/* Details */}
                  <div className="min-w-0 flex-1 space-y-2 sm:space-y-3">
                    {/* Top Row: Name & Badges */}
                    <div className="flex flex-wrap items-start justify-between gap-1">
                      <span className="font-semibold sm:text-lg">
                        {sighting.full_name}
                      </span>
                      <div className="flex flex-wrap gap-1">
                        <Badge
                          variant={
                            sighting.contest_eligible ? 'default' : 'secondary'
                          }
                          className={`text-xs ${sighting.contest_eligible ? 'bg-green-600' : ''}`}
                        >
                          {sighting.contest_eligible
                            ? '✓ Eligible'
                            : 'Coupon Only'}
                        </Badge>
                        {sighting.share_verified && (
                          <Badge
                            variant="outline"
                            className="border-blue-500 text-xs text-blue-600 dark:text-blue-400"
                          >
                            ✓ Shared
                          </Badge>
                        )}
                      </div>
                    </div>

                    {/* Contact Details */}
                    <div className="space-y-0.5 text-xs sm:text-sm">
                      <div className="flex items-center gap-1">
                        <Mail className="text-muted-foreground h-3 w-3" />
                        <span className="truncate">{sighting.email}</span>
                      </div>
                      <div className="text-muted-foreground">
                        📱 {sighting.phone_number}
                      </div>
                      {sighting.zip_code && (
                        <div className="text-muted-foreground">
                          📍 Zip: {sighting.zip_code}
                        </div>
                      )}
                    </div>

                    {/* Coupon Code */}
                    <p className="text-muted-foreground font-mono text-xs">
                      {sighting.coupon_code}
                    </p>

                    {/* View on Map Link */}
                    {sighting.gps_lat && sighting.gps_lng && (
                      <Link
                        href="/"
                        className="flex items-center gap-1 text-xs text-green-600 hover:underline sm:text-sm dark:text-green-400"
                      >
                        <MapPin className="h-3 w-3" />
                        View on Map
                      </Link>
                    )}

                    {/* Location & Date */}
                    <div className="text-muted-foreground flex flex-wrap gap-2 text-xs sm:gap-4 sm:text-sm">
                      {sighting.gps_lat && sighting.gps_lng && (
                        <div className="flex items-center gap-1">
                          <MapPin className="h-3 w-3" />
                          <span>
                            {sighting.gps_lat.toFixed(4)},{' '}
                            {sighting.gps_lng.toFixed(4)}
                          </span>
                        </div>
                      )}
                      <div className="flex items-center gap-1">
                        <Calendar className="h-3 w-3" />
                        <span>
                          {new Date(sighting.created_at).toLocaleDateString(
                            'en-US',
                            {
                              month: 'short',
                              day: 'numeric',
                              hour: '2-digit',
                              minute: '2-digit',
                            },
                          )}
                        </span>
                      </div>
                    </div>

                    {/* Coupon Redeemed Checkbox & Delete Button */}
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="bg-muted/30 flex items-center space-x-2 rounded-md border px-2 py-1.5">
                        <Checkbox
                          id={`redeemed-${sighting.id}`}
                          checked={sighting.coupon_redeemed}
                          onCheckedChange={() =>
                            handleToggleRedeemed(
                              sighting.id,
                              sighting.coupon_redeemed,
                            )
                          }
                          disabled={updatingId === sighting.id}
                          className="h-4 w-4"
                        />
                        <Label
                          htmlFor={`redeemed-${sighting.id}`}
                          className="cursor-pointer text-xs font-medium sm:text-sm"
                        >
                          {updatingId === sighting.id ? (
                            <span className="flex items-center gap-1">
                              <Loader2 className="h-3 w-3 animate-spin" />
                              ...
                            </span>
                          ) : (
                            'Coupon Redeemed'
                          )}
                        </Label>
                      </div>
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() =>
                          handleDelete(sighting.id, sighting.full_name)
                        }
                        disabled={deletingId === sighting.id}
                        className="h-8 px-2 text-xs sm:px-3 sm:text-sm"
                      >
                        {deletingId === sighting.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <>
                            <Trash2 className="mr-1 h-3 w-3 sm:mr-2 sm:h-4 sm:w-4" />
                            Delete
                          </>
                        )}
                      </Button>
                    </div>
                  </div>
                </div>
              </Card>
            ))
          )}
        </div>
      )}

      {/* Conversations View */}
      {activeView === 'conversations' && (
        <div className="space-y-4">
          {/* Filter buttons */}
          <div className="grid grid-cols-3 gap-2">
            <button
              onClick={() => setConvoFilter('all')}
              className={`rounded-lg border p-2 text-center transition-all ${
                convoFilter === 'all'
                  ? 'bg-blue-50 ring-2 ring-blue-500 dark:bg-blue-950'
                  : 'hover:bg-gray-50 dark:hover:bg-gray-800'
              }`}
            >
              <div className="text-lg font-bold">{conversations.length}</div>
              <div className="text-xs text-gray-500">Total</div>
            </button>
            <button
              onClick={() => setConvoFilter('active')}
              className={`rounded-lg border p-2 text-center transition-all ${
                convoFilter === 'active'
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
              onClick={() => setConvoFilter('escalated')}
              className={`rounded-lg border p-2 text-center transition-all ${
                convoFilter === 'escalated'
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
            <Card className="py-8 text-center text-gray-500">
              {convoFilter === 'all'
                ? "No contest conversations yet. When someone texts about a sighting, they'll appear here."
                : `No ${convoFilter} conversations.`}
            </Card>
          ) : (
            <div className="space-y-2">
              {filteredConversations.map((convo) => {
                const lastMessage = convo.messages[convo.messages.length - 1]
                return (
                  <Card
                    key={convo.id}
                    onClick={() => setSelectedConvo(convo)}
                    className="cursor-pointer p-3 transition-colors hover:bg-gray-50 dark:hover:bg-gray-800"
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
                  </Card>
                )
              })}
            </div>
          )}
        </div>
      )}

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
