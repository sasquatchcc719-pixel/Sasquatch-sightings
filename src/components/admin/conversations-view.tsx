'use client'

import { useState } from 'react'
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
} from 'lucide-react'
import { useRouter } from 'next/navigation'

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

export function ConversationsView({
  conversations: initialConversations,
}: ConversationsViewProps) {
  const router = useRouter()
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

  // Filter conversations based on selected status
  const filteredConversations =
    filterStatus === 'all'
      ? conversations
      : conversations.filter((c) => c.status === filterStatus)

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
        router.refresh() // Refresh to show new message
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
          setSelectedConvo({ ...selectedConvo, status: newStatus as any })
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
        setSelectedConvo(null)
        setConfirmDelete(false)
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
        timeZone: 'America/Denver', // Colorado timezone
      })
    } catch (e) {
      return timestamp
    }
  }

  return (
    <div className="space-y-4">
      {/* Stats */}
      <div className="grid grid-cols-3 gap-3 sm:gap-4 md:grid-cols-3">
        <button
          onClick={() => setFilterStatus('all')}
          className={`text-left transition-all ${
            filterStatus === 'all' ? 'ring-primary ring-2' : ''
          }`}
        >
          <Card className="hover:bg-muted/50 cursor-pointer">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 p-3 pb-2 sm:p-4">
              <CardTitle className="text-xs leading-tight font-medium sm:text-sm">
                Total Conversations
              </CardTitle>
              <MessageSquare className="text-muted-foreground h-3 w-3 flex-shrink-0 sm:h-4 sm:w-4" />
            </CardHeader>
            <CardContent className="p-3 pt-0 sm:p-4">
              <div className="text-2xl font-bold sm:text-3xl">
                {conversations.length}
              </div>
              {filterStatus === 'all' && (
                <p className="text-muted-foreground mt-1 text-xs">
                  Showing all
                </p>
              )}
            </CardContent>
          </Card>
        </button>

        <button
          onClick={() => setFilterStatus('active')}
          className={`text-left transition-all ${
            filterStatus === 'active' ? 'ring-primary ring-2' : ''
          }`}
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
              {filterStatus === 'active' && (
                <p className="text-muted-foreground mt-1 text-xs">Filtered</p>
              )}
            </CardContent>
          </Card>
        </button>

        <button
          onClick={() => setFilterStatus('escalated')}
          className={`text-left transition-all ${
            filterStatus === 'escalated' ? 'ring-primary ring-2' : ''
          }`}
        >
          <Card className="hover:bg-muted/50 cursor-pointer">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 p-3 pb-2 sm:p-4">
              <CardTitle className="text-xs leading-tight font-medium sm:text-sm">
                Need Attention
              </CardTitle>
              <AlertCircle className="text-muted-foreground h-3 w-3 flex-shrink-0 sm:h-4 sm:w-4" />
            </CardHeader>
            <CardContent className="p-3 pt-0 sm:p-4">
              <div className="text-2xl font-bold sm:text-3xl">
                {conversations.filter((c) => c.status === 'escalated').length}
              </div>
              {filterStatus === 'escalated' && (
                <p className="text-muted-foreground mt-1 text-xs">Filtered</p>
              )}
            </CardContent>
          </Card>
        </button>
      </div>

      {/* Conversations List */}
      <Card>
        <CardHeader>
          <CardTitle>Conversations</CardTitle>
          <CardDescription>
            {filteredConversations.length === 0
              ? filterStatus === 'all'
                ? 'No conversations yet'
                : `No ${filterStatus} conversations`
              : 'Click a conversation to view full message history'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {filteredConversations.length === 0 ? (
            <div className="text-muted-foreground py-8 text-center">
              {filterStatus === 'all'
                ? "No conversations yet. When customers text your Twilio number, they'll appear here."
                : `No ${filterStatus} conversations. Click "Total Conversations" to see all.`}
            </div>
          ) : (
            <div className="space-y-2">
              {filteredConversations.map((convo) => {
                const messageCount = convo.messages.length
                const lastMessage = convo.messages[messageCount - 1]

                return (
                  <div
                    key={convo.id}
                    onClick={() => setSelectedConvo(convo)}
                    className="hover:bg-muted w-full cursor-pointer rounded-lg border p-3 text-left transition-colors sm:p-4"
                  >
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                      <div className="min-w-0 flex-1">
                        <div className="mb-1 flex flex-wrap items-center gap-2">
                          <a
                            href={`tel:${convo.phone_number}`}
                            className="text-sm font-medium text-blue-400 hover:underline sm:text-base"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {convo.phone_number}
                          </a>
                          {getStatusBadge(convo.status)}
                        </div>
                        {convo.lead?.name && (
                          <div className="text-muted-foreground mb-1 text-xs sm:text-sm">
                            {convo.lead.name}
                          </div>
                        )}
                        {lastMessage && (
                          <div className="text-muted-foreground line-clamp-2 text-xs sm:text-sm">
                            {lastMessage.role === 'user' ? '💬 ' : '🤖 '}
                            {lastMessage.content}
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-2 text-right sm:flex-col sm:items-end sm:gap-0">
                        <div className="text-muted-foreground text-xs whitespace-nowrap">
                          {formatTime(convo.updated_at)}
                        </div>
                        <div className="text-muted-foreground text-xs sm:mt-1">
                          {messageCount} msg{messageCount !== 1 ? 's' : ''}
                        </div>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Conversation Detail Modal */}
      {selectedConvo && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => {
            setSelectedConvo(null)
            setConfirmDelete(false)
          }}
        >
          <div
            className="bg-background flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="border-b p-4">
              <div className="mb-2 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <a
                    href={`tel:${selectedConvo.phone_number}`}
                    className="text-lg font-semibold text-blue-400 hover:underline"
                  >
                    {selectedConvo.phone_number}
                  </a>
                  {getStatusBadge(selectedConvo.status)}
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
                <div className="text-muted-foreground mb-2 text-sm">
                  Lead: {selectedConvo.lead.name} ({selectedConvo.lead.source})
                </div>
              )}
              <div className="text-muted-foreground mb-3 text-xs">
                Started: {formatTime(selectedConvo.created_at)} •{' '}
                {selectedConvo.messages.length} messages
              </div>

              {/* Action Buttons */}
              <div className="flex flex-wrap gap-2">
                {selectedConvo.status !== 'completed' && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      handleUpdateStatus(selectedConvo.id, 'completed')
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
                    Flag for Attention
                  </Button>
                )}

                {/* Delete Button */}
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
                      onClick={handleDelete}
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
                          : 'bg-muted'
                    }`}
                  >
                    <div className="text-sm whitespace-pre-wrap">
                      {msg.content}
                    </div>
                    <div
                      className={`mt-1 text-xs ${
                        msg.role === 'user'
                          ? 'text-blue-100'
                          : 'text-muted-foreground'
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
              <p className="text-muted-foreground mt-2 text-xs">
                Press Cmd/Ctrl + Enter to send
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
