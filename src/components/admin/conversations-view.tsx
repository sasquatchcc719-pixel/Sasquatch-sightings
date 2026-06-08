'use client'

import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import {
  MessageSquare,
  Phone,
  AlertCircle,
  CheckCircle,
  Clock,
  Send,
  X,
  Trash2,
  Plus,
  MessageCircle,
  Bot,
  Loader2,
  Lock,
} from 'lucide-react'
import { useRouter } from 'next/navigation'
import { CallButton } from '@/components/admin/softphone'
import { useQueryClient } from '@tanstack/react-query'
import { countUnreadInboundMessages } from '@/lib/conversations-unread'

type Message = {
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp: string
  twilio_sid?: string
}

type Conversation = {
  id: string
  phone_number: string
  source: string | null
  lead_id: string | null
  messages: Message[]
  ai_enabled: boolean
  ops_customer_id: string | null
  admin_read_at: string | null
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

type ConversationsViewProps = {
  conversations: Conversation[]
}

// Build initials from a name or phone number
function getInitials(name: string | null | undefined, phone: string): string {
  if (name && name.trim()) {
    const parts = name.trim().split(/\s+/)
    if (parts.length >= 2) {
      return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
    }
    return name.slice(0, 2).toUpperCase()
  }
  // Use last 2 digits of phone as fallback
  const digits = phone.replace(/\D/g, '')
  return digits.slice(-2)
}

// Consistent avatar color based on phone number
function getAvatarColor(phone: string): string {
  const colors = [
    'bg-blue-500',
    'bg-purple-500',
    'bg-teal-500',
    'bg-orange-500',
    'bg-pink-500',
    'bg-indigo-500',
    'bg-cyan-500',
    'bg-rose-500',
  ]
  const digits = phone.replace(/\D/g, '')
  const idx = parseInt(digits.slice(-2) || '0', 10) % colors.length
  return colors[idx]
}

export function ConversationsView({
  conversations: initialConversations,
}: ConversationsViewProps) {
  const router = useRouter()
  const queryClient = useQueryClient()
  const [conversations, setConversations] =
    useState<Conversation[]>(initialConversations)
  const [selectedConvo, setSelectedConvo] = useState<Conversation | null>(null)
  const [filterStatus, setFilterStatus] = useState<
    'all' | 'active' | 'completed' | 'escalated'
  >('all')
  const [replyText, setReplyText] = useState('')
  const [sending, setSending] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [bulkDeleting, setBulkDeleting] = useState(false)
  const [composeOpen, setComposeOpen] = useState(false)
  const [composePhone, setComposePhone] = useState('')
  const [composeMessage, setComposeMessage] = useState('')
  const [composeSending, setComposeSending] = useState(false)
  const [harryDraftLoading, setHarryDraftLoading] = useState(false)
  const [autoReplyUpdating, setAutoReplyUpdating] = useState(false)
  const [markingAllRead, setMarkingAllRead] = useState(false)

  // Optimistic read state: track which conversations have been marked read this session
  const [localReadIds, setLocalReadIds] = useState<Set<string>>(new Set())

  // Auto-refresh conversations every 10 seconds to catch new messages
  useEffect(() => {
    const refreshInterval = setInterval(() => {
      router.refresh()
    }, 10000) // 10 seconds

    return () => clearInterval(refreshInterval)
  }, [router])

  // Update local state when server data changes (after router.refresh())
  useEffect(() => {
    setConversations(initialConversations)
  }, [initialConversations])

  const filteredConversations =
    filterStatus === 'all'
      ? conversations
      : conversations.filter((c) => c.status === filterStatus)
  const allFilteredIds = filteredConversations.map((c) => c.id)
  const allFilteredSelected =
    allFilteredIds.length > 0 &&
    allFilteredIds.every((id) => selectedIds.includes(id))

  const openConversation = async (convo: Conversation) => {
    setSelectedConvo(convo)
    setReplyText('')

    const unread = countUnreadInboundMessages(convo)
    if (unread > 0) {
      // Optimistically mark as read in UI
      setLocalReadIds((prev) => new Set([...prev, convo.id]))

      // Persist to server
      try {
        await fetch(`/api/conversations/${convo.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'mark_read' }),
        })
        // Invalidate the unread count so the bottom nav badge refreshes
        queryClient.invalidateQueries({ queryKey: ['comms-unread'] })
      } catch {
        // Non-critical: badge will fix itself on next poll
      }
    }
  }

  const markAllAsRead = async () => {
    if (markingAllRead) return
    setMarkingAllRead(true)
    try {
      const response = await fetch('/api/admin/conversations/unread-count', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
      })
      if (response.ok) {
        // Mark all conversations as read in local state
        const allIds = conversations.map((c) => c.id)
        setLocalReadIds(new Set(allIds))
        // Refresh the page to update unread counts
        router.refresh()
        // Invalidate the unread count query
        queryClient.invalidateQueries({ queryKey: ['comms-unread'] })
      }
    } catch (error) {
      console.error('Failed to mark all as read:', error)
    } finally {
      setMarkingAllRead(false)
    }
  }

  const isLsaConversation = (convo: Conversation | null): boolean => {
    if (!convo) return false
    return convo.source === 'Google LSA' || convo.source === 'lsa'
  }

  const handleToggleAutoReply = async () => {
    if (!selectedConvo || autoReplyUpdating) return
    if (isLsaConversation(selectedConvo)) {
      alert(
        'Google LSA conversations must remain automated. Harry auto-reply cannot be disabled for LSA leads.',
      )
      return
    }
    const next = !selectedConvo.ai_enabled
    setAutoReplyUpdating(true)
    try {
      const res = await fetch(`/api/conversations/${selectedConvo.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'set_auto_reply', enabled: next }),
      })
      if (!res.ok) {
        const payload = (await res.json().catch(() => null)) as {
          error?: string
        } | null
        alert(payload?.error || 'Failed to update auto-reply setting.')
        return
      }
      // Optimistic local update
      setSelectedConvo({ ...selectedConvo, ai_enabled: next })
    } catch {
      alert('Network error updating auto-reply setting.')
    } finally {
      setAutoReplyUpdating(false)
    }
  }

  const handleAskHarry = async () => {
    if (!selectedConvo) return
    setHarryDraftLoading(true)
    try {
      const res = await fetch(
        `/api/admin/conversations/${selectedConvo.id}/harry-draft`,
        { method: 'POST' },
      )
      if (res.ok) {
        const { draft } = await res.json()
        setReplyText(draft || '')
      } else {
        alert(
          "Harry couldn't generate a draft right now. Try again or reply manually.",
        )
      }
    } catch {
      alert('Failed to reach Harry. Check your connection.')
    } finally {
      setHarryDraftLoading(false)
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
        router.refresh()
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
        router.refresh()
        if (selectedConvo?.id === conversationId) {
          setSelectedConvo({
            ...selectedConvo,
            status: newStatus as 'active' | 'completed' | 'escalated',
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

  const handleDelete = async () => {
    if (!selectedConvo) return

    setDeleting(true)
    try {
      const response = await fetch(`/api/conversations/${selectedConvo.id}`, {
        method: 'DELETE',
      })

      if (response.ok) {
        setConversations((prev) =>
          prev.filter((c) => c.id !== selectedConvo.id),
        )
        setSelectedIds((current) =>
          current.filter((id) => id !== selectedConvo.id),
        )
        setSelectedConvo(null)
        setConfirmDelete(false)
        queryClient.invalidateQueries({ queryKey: ['comms-unread'] })
        router.refresh()
      } else {
        alert('Failed to delete conversation')
      }
    } catch (error) {
      console.error('Delete error:', error)
      alert('Failed to delete conversation')
    } finally {
      setDeleting(false)
    }
  }

  const toggleConversationSelected = (conversationId: string) => {
    setSelectedIds((current) =>
      current.includes(conversationId)
        ? current.filter((id) => id !== conversationId)
        : [...current, conversationId],
    )
  }

  const toggleSelectAllFiltered = () => {
    if (allFilteredSelected) {
      setSelectedIds((current) =>
        current.filter((id) => !allFilteredIds.includes(id)),
      )
      return
    }
    setSelectedIds((current) => {
      const next = [...current]
      for (const id of allFilteredIds) {
        if (!next.includes(id)) next.push(id)
      }
      return next
    })
  }

  const handleBulkDelete = async () => {
    if (selectedIds.length === 0) return
    const confirmed = window.confirm(
      `Delete ${selectedIds.length} selected conversation${selectedIds.length === 1 ? '' : 's'}? This cannot be undone.`,
    )
    if (!confirmed) return

    setBulkDeleting(true)
    try {
      const response = await fetch('/api/conversations/bulk-delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: selectedIds }),
      })
      if (!response.ok) {
        alert('Failed to delete selected conversations')
        return
      }
      setConversations((current) =>
        current.filter(
          (conversation) => !selectedIds.includes(conversation.id),
        ),
      )
      if (selectedConvo && selectedIds.includes(selectedConvo.id)) {
        setSelectedConvo(null)
        setConfirmDelete(false)
      }
      setSelectedIds([])
      queryClient.invalidateQueries({ queryKey: ['comms-unread'] })
      router.refresh()
    } catch (error) {
      console.error('Bulk delete error:', error)
      alert('Failed to delete selected conversations')
    } finally {
      setBulkDeleting(false)
    }
  }

  const handleComposeSend = async () => {
    if (!composePhone.trim() || !composeMessage.trim()) return

    setComposeSending(true)
    try {
      const response = await fetch('/api/conversations/new', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phoneNumber: composePhone.trim(),
          message: composeMessage.trim(),
        }),
      })

      if (response.ok) {
        setComposeOpen(false)
        setComposePhone('')
        setComposeMessage('')
        router.refresh()
      } else {
        const data = await response.json()
        alert(data.error || 'Failed to send message')
      }
    } catch (error) {
      console.error('Compose send error:', error)
      alert('Failed to send message')
    } finally {
      setComposeSending(false)
    }
  }

  const getSourceLabel = (source: string | null) => {
    if (!source) return null
    const labels: Record<string, string> = {
      inbound: 'Direct',
      'NFC Card': 'Vendor',
      nfc_card: 'Vendor',
      'Business Card': 'Your Card',
      Contest: 'Contest',
      'Google LSA': 'Google LSA',
      Yelp: 'Yelp',
      admin_outbound: 'Outbound',
    }
    return labels[source] || source
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

  const formatRelativeTime = (timestamp: string) => {
    try {
      const d = new Date(timestamp)
      const now = new Date()
      const diffMs = now.getTime() - d.getTime()
      const diffMins = Math.floor(diffMs / 60000)
      if (diffMins < 1) return 'Just now'
      if (diffMins < 60) return `${diffMins}m ago`
      const diffHours = Math.floor(diffMins / 60)
      if (diffHours < 24) return `${diffHours}h ago`
      const diffDays = Math.floor(diffHours / 24)
      if (diffDays === 1) return 'Yesterday'
      if (diffDays < 7) return `${diffDays}d ago`
      return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    } catch {
      return ''
    }
  }

  return (
    <div className="space-y-4">
      {/* Stats */}
      <div className="grid grid-cols-3 gap-3 sm:gap-4">
        <button
          onClick={() => setFilterStatus('all')}
          className={`text-left transition-all ${filterStatus === 'all' ? 'ring-primary ring-2' : ''}`}
        >
          <Card className="hover:bg-muted/50 cursor-pointer">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 p-3 pb-2 sm:p-4">
              <CardTitle className="text-xs leading-tight font-medium sm:text-sm">
                Total
              </CardTitle>
              <MessageSquare className="text-muted-foreground h-3 w-3 flex-shrink-0 sm:h-4 sm:w-4" />
            </CardHeader>
            <CardContent className="p-3 pt-0 sm:p-4">
              <div className="text-2xl font-bold sm:text-3xl">
                {conversations.length}
              </div>
            </CardContent>
          </Card>
        </button>

        <button
          onClick={() => setFilterStatus('active')}
          className={`text-left transition-all ${filterStatus === 'active' ? 'ring-primary ring-2' : ''}`}
        >
          <Card className="hover:bg-muted/50 cursor-pointer">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 p-3 pb-2 sm:p-4">
              <CardTitle className="text-xs font-medium sm:text-sm">
                Active
              </CardTitle>
              <Clock className="text-muted-foreground h-3 w-3 flex-shrink-0 sm:h-4 sm:w-4" />
            </CardHeader>
            <CardContent className="p-3 pt-0 sm:p-4">
              <div className="text-2xl font-bold sm:text-3xl">
                {conversations.filter((c) => c.status === 'active').length}
              </div>
            </CardContent>
          </Card>
        </button>

        <button
          onClick={() => setFilterStatus('escalated')}
          className={`text-left transition-all ${filterStatus === 'escalated' ? 'ring-primary ring-2' : ''}`}
        >
          <Card className="hover:bg-muted/50 cursor-pointer">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 p-3 pb-2 sm:p-4">
              <CardTitle className="text-xs leading-tight font-medium sm:text-sm">
                Attention
              </CardTitle>
              <AlertCircle className="text-muted-foreground h-3 w-3 flex-shrink-0 sm:h-4 sm:w-4" />
            </CardHeader>
            <CardContent className="p-3 pt-0 sm:p-4">
              <div className="text-2xl font-bold sm:text-3xl">
                {conversations.filter((c) => c.status === 'escalated').length}
              </div>
            </CardContent>
          </Card>
        </button>
      </div>

      {/* Conversations List */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Conversations</CardTitle>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={markAllAsRead}
                disabled={markingAllRead}
              >
                {markingAllRead ? (
                  <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                ) : (
                  <CheckCircle className="mr-1 h-4 w-4" />
                )}
                Mark All Read
              </Button>
              <Button size="sm" onClick={() => setComposeOpen(true)}>
                <Plus className="mr-1 h-4 w-4" />
                New Message
              </Button>
            </div>
          </div>
          <CardDescription>
            {filteredConversations.length === 0
              ? filterStatus === 'all'
                ? 'No conversations yet'
                : `No ${filterStatus} conversations`
              : 'Tap a conversation to read and reply'}
          </CardDescription>
          {filteredConversations.length > 0 && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={toggleSelectAllFiltered}
              >
                {allFilteredSelected ? 'Unselect All' : 'Select All'}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setSelectedIds([])}
                disabled={selectedIds.length === 0}
              >
                Clear
              </Button>
              <Button
                size="sm"
                variant="destructive"
                onClick={handleBulkDelete}
                disabled={selectedIds.length === 0 || bulkDeleting}
              >
                {bulkDeleting
                  ? 'Deleting...'
                  : `Delete (${selectedIds.length})`}
              </Button>
            </div>
          )}
        </CardHeader>
        <CardContent className="p-0">
          {filteredConversations.length === 0 ? (
            <div className="text-muted-foreground px-4 py-8 text-center text-sm">
              {filterStatus === 'all'
                ? "No conversations yet. When customers text, they'll appear here."
                : `No ${filterStatus} conversations.`}
            </div>
          ) : (
            <div>
              {filteredConversations.map((convo, i) => {
                const isLast = i === filteredConversations.length - 1
                const lastMessage = convo.messages[convo.messages.length - 1]
                const displayName = convo.lead?.name || null
                const initials = getInitials(displayName, convo.phone_number)
                const avatarColor = getAvatarColor(convo.phone_number)
                const isLocallyRead = localReadIds.has(convo.id)
                const unread = isLocallyRead
                  ? 0
                  : countUnreadInboundMessages(convo)
                const isUnread = unread > 0
                const isOpsCustomer = !!convo.ops_customer_id

                return (
                  <div
                    key={convo.id}
                    className={`flex items-center gap-3 px-4 py-3.5 transition-colors ${
                      !isLast ? 'border-b border-white/5' : ''
                    } ${isUnread ? 'bg-white/3' : ''} cursor-pointer hover:bg-white/5 active:bg-white/10`}
                    onClick={() => openConversation(convo)}
                  >
                    {/* Checkbox */}
                    <input
                      type="checkbox"
                      checked={selectedIds.includes(convo.id)}
                      onChange={() => toggleConversationSelected(convo.id)}
                      onClick={(e) => e.stopPropagation()}
                      aria-label={`Select ${convo.phone_number}`}
                      className="flex-shrink-0"
                    />

                    {/* Avatar */}
                    <div
                      className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full text-sm font-semibold text-white ${avatarColor}`}
                    >
                      {initials}
                    </div>

                    {/* Content */}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-2">
                        <span
                          className={`truncate text-sm ${
                            isUnread
                              ? 'font-semibold text-white'
                              : 'font-medium text-slate-200'
                          }`}
                        >
                          {displayName || convo.phone_number}
                          {isOpsCustomer && (
                            <span className="ml-1.5 text-[10px] font-normal text-emerald-400">
                              Scheduled
                            </span>
                          )}
                        </span>
                        <span className="flex-shrink-0 text-[11px] text-slate-500">
                          {formatRelativeTime(convo.updated_at)}
                        </span>
                      </div>
                      <div className="mt-0.5 flex items-center justify-between gap-2">
                        <p
                          className={`truncate text-xs ${
                            isUnread ? 'text-slate-300' : 'text-slate-500'
                          }`}
                        >
                          {lastMessage
                            ? (lastMessage.role === 'user' ? '' : '↩ ') +
                              lastMessage.content
                            : 'No messages yet'}
                        </p>
                        {unread > 0 && (
                          <span className="flex h-5 min-w-5 flex-shrink-0 items-center justify-center rounded-full bg-red-500 px-1.5 text-[10px] font-bold text-white">
                            {unread > 99 ? '99+' : unread}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Compose New Message Modal */}
      {composeOpen && (
        <div
          className="fixed inset-0 z-[220] flex items-center justify-center bg-black/50 p-4"
          onClick={() => setComposeOpen(false)}
        >
          <div
            className="bg-background w-full max-w-md rounded-xl p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-semibold">New Message</h3>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setComposeOpen(false)}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium">Phone Number</label>
                <input
                  type="tel"
                  value={composePhone}
                  onChange={(e) => setComposePhone(e.target.value)}
                  placeholder="(719) 555-1234"
                  className="border-input bg-background mt-1 w-full rounded-md border px-3 py-2 text-sm"
                  autoFocus
                />
              </div>
              <div>
                <label className="text-sm font-medium">Message</label>
                <Textarea
                  value={composeMessage}
                  onChange={(e) => setComposeMessage(e.target.value)}
                  placeholder="Type your message..."
                  className="mt-1 min-h-[100px]"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                      void handleComposeSend()
                    }
                  }}
                />
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setComposeOpen(false)}>
                  Cancel
                </Button>
                <Button
                  onClick={() => void handleComposeSend()}
                  disabled={
                    !composePhone.trim() ||
                    !composeMessage.trim() ||
                    composeSending
                  }
                >
                  {composeSending ? (
                    'Sending...'
                  ) : (
                    <>
                      <Send className="mr-1 h-4 w-4" />
                      Send
                    </>
                  )}
                </Button>
              </div>
              <p className="text-muted-foreground text-xs">
                Sends from the Sasquatch business line. Cmd/Ctrl + Enter to
                send.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Conversation Detail Modal */}
      {selectedConvo &&
        createPortal(
          <div
            className="fixed inset-0 z-[220] flex items-end justify-center bg-black/60 sm:items-center sm:p-4"
            onClick={() => {
              setSelectedConvo(null)
              setConfirmDelete(false)
            }}
          >
            <div
              className="bg-background flex h-[100dvh] w-full max-w-2xl flex-col overflow-hidden rounded-t-2xl shadow-xl sm:h-auto sm:max-h-[92vh] sm:rounded-xl"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header */}
              <div className="flex-shrink-0 border-b p-4">
                <div className="mb-2 flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    {/* Avatar in modal header */}
                    <div
                      className={`flex h-9 w-9 items-center justify-center rounded-full text-xs font-bold text-white ${getAvatarColor(selectedConvo.phone_number)}`}
                    >
                      {getInitials(
                        selectedConvo.lead?.name,
                        selectedConvo.phone_number,
                      )}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-base font-semibold">
                          {selectedConvo.lead?.name ||
                            selectedConvo.phone_number}
                        </span>
                        {selectedConvo.ops_customer_id && (
                          <span className="rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-medium text-emerald-400">
                            Scheduled Customer
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5">
                        <a
                          href={`tel:${selectedConvo.phone_number}`}
                          className="text-xs text-blue-400 hover:underline"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {selectedConvo.phone_number}
                        </a>
                        <CallButton phoneNumber={selectedConvo.phone_number} />
                        {getStatusBadge(selectedConvo.status)}
                      </div>
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setSelectedConvo(null)
                      setConfirmDelete(false)
                    }}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>

                {selectedConvo.lead && (
                  <div className="text-muted-foreground mb-2 text-xs">
                    Lead: {selectedConvo.lead.name} ({selectedConvo.lead.source}
                    )
                  </div>
                )}
                <div className="text-muted-foreground mb-3 text-xs">
                  Started {formatTime(selectedConvo.created_at)} ·{' '}
                  {selectedConvo.messages.length} messages
                  {getSourceLabel(selectedConvo.source) && (
                    <span className="ml-1 text-slate-500">
                      · {getSourceLabel(selectedConvo.source)}
                    </span>
                  )}
                </div>

                {/* Action Buttons */}
                <div className="flex flex-wrap gap-2">
                  {selectedConvo.status !== 'completed' && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        void handleUpdateStatus(selectedConvo.id, 'completed')
                      }
                    >
                      <CheckCircle className="mr-1 h-3 w-3" />
                      Mark Complete
                    </Button>
                  )}
                  {selectedConvo.status === 'completed' && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        void handleUpdateStatus(selectedConvo.id, 'active')
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
                        void handleUpdateStatus(selectedConvo.id, 'escalated')
                      }
                    >
                      <AlertCircle className="mr-1 h-3 w-3" />
                      Flag
                    </Button>
                  )}

                  {confirmDelete ? (
                    <div className="flex items-center gap-2">
                      <span className="text-muted-foreground text-sm">
                        Delete?
                      </span>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setConfirmDelete(false)}
                      >
                        Cancel
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => void handleDelete()}
                        disabled={deleting}
                      >
                        {deleting ? 'Deleting...' : 'Confirm'}
                      </Button>
                    </div>
                  ) : (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-destructive hover:text-destructive"
                      onClick={() => setConfirmDelete(true)}
                    >
                      <Trash2 className="mr-1 h-3 w-3" />
                      Delete
                    </Button>
                  )}
                </div>
              </div>

              {/* Messages */}
              <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
                {selectedConvo.messages.length === 0 ? (
                  <div className="text-muted-foreground py-8 text-center text-sm">
                    No messages yet
                  </div>
                ) : (
                  selectedConvo.messages.map((msg, idx) => (
                    <div
                      key={idx}
                      className={`flex ${msg.role === 'user' ? 'justify-start' : 'justify-end'}`}
                    >
                      <div
                        className={`max-w-[80%] rounded-2xl px-3.5 py-2.5 ${
                          msg.role === 'user'
                            ? 'rounded-tl-sm bg-white/10 text-slate-100'
                            : msg.role === 'system'
                              ? 'rounded-tr-sm bg-red-500/15 text-xs text-red-300'
                              : 'rounded-tr-sm bg-emerald-600/80 text-white'
                        }`}
                      >
                        <div className="text-sm whitespace-pre-wrap">
                          {msg.content}
                        </div>
                        <div
                          className={`mt-1 text-[10px] ${
                            msg.role === 'user'
                              ? 'text-slate-400'
                              : 'text-white/60'
                          }`}
                        >
                          {msg.timestamp ? formatTime(msg.timestamp) : ''}
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>

              {/* Reply Box */}
              <div className="flex-shrink-0 border-t p-4">
                {(() => {
                  const lsa = isLsaConversation(selectedConvo)
                  const autoOn = selectedConvo.ai_enabled
                  return (
                    <>
                      <div className="mb-3 flex flex-wrap items-center gap-2">
                        <Button
                          asChild
                          variant="outline"
                          size="sm"
                          className="bg-green-600 text-white hover:bg-green-700 hover:text-white"
                        >
                          <a href={`sms:${selectedConvo.phone_number}`}>
                            <MessageCircle className="mr-1.5 h-3.5 w-3.5" />
                            Open in Messages
                          </a>
                        </Button>

                        {/* Auto/Manual toggle — locked Auto for LSA, togglable otherwise */}
                        <button
                          type="button"
                          onClick={() => {
                            if (lsa) return
                            void handleToggleAutoReply()
                          }}
                          disabled={lsa || autoReplyUpdating}
                          aria-pressed={autoOn}
                          title={
                            lsa
                              ? 'Google LSA conversations must stay automated.'
                              : autoOn
                                ? 'Harry is auto-replying. Tap to switch to manual.'
                                : 'Manual mode. Tap to let Harry auto-reply again.'
                          }
                          className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                            autoOn
                              ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300'
                              : 'border-amber-500/40 bg-amber-500/15 text-amber-300'
                          } ${lsa ? 'cursor-not-allowed opacity-90' : 'hover:brightness-110'}`}
                        >
                          {autoReplyUpdating ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : lsa ? (
                            <Lock className="h-3.5 w-3.5" />
                          ) : (
                            <Bot className="h-3.5 w-3.5" />
                          )}
                          <span>
                            Harry: {autoOn ? 'Auto' : 'Manual'}
                            {lsa ? ' (LSA)' : ''}
                          </span>
                        </button>

                        {/* Ask Harry draft button — only in manual mode */}
                        {!autoOn && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="border-emerald-500/40 text-emerald-400 hover:border-emerald-400 hover:text-emerald-300"
                            onClick={() => void handleAskHarry()}
                            disabled={harryDraftLoading}
                          >
                            {harryDraftLoading ? (
                              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Bot className="mr-1.5 h-3.5 w-3.5" />
                            )}
                            {harryDraftLoading ? 'Asking Harry…' : 'Ask Harry'}
                          </Button>
                        )}
                      </div>

                      {/* Helper text explaining the current mode */}
                      {lsa ? (
                        <p className="text-muted-foreground mb-2 text-xs">
                          Google LSA is fully automated — Harry handles these
                          leads end-to-end.
                        </p>
                      ) : !autoOn && !harryDraftLoading && !replyText ? (
                        <p className="text-muted-foreground mb-2 text-xs">
                          Manual mode: Harry won&apos;t reply automatically. Tap
                          &ldquo;Ask Harry&rdquo; for a draft, or type your own
                          reply.
                        </p>
                      ) : null}

                      <div className="flex gap-2">
                        <Textarea
                          value={replyText}
                          onChange={(e) => setReplyText(e.target.value)}
                          placeholder={
                            !autoOn
                              ? 'Ask Harry for a draft or type your reply…'
                              : 'Type your reply…'
                          }
                          className="min-h-[80px] flex-1"
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                              void handleSendReply()
                            }
                          }}
                        />
                        <Button
                          onClick={() => void handleSendReply()}
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
                      <p className="text-muted-foreground mt-2 text-xs">
                        Cmd/Ctrl + Enter to send
                      </p>
                    </>
                  )
                })()}
              </div>
            </div>
          </div>,
          document.body,
        )}
    </div>
  )
}
