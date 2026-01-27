'use client'

import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { MessageSquare, Phone, AlertCircle, CheckCircle, Clock, Send, X } from 'lucide-react'
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

export function ConversationsView({ conversations }: ConversationsViewProps) {
  const router = useRouter()
  const [selectedConvo, setSelectedConvo] = useState<Conversation | null>(null)
  const [filterStatus, setFilterStatus] = useState<'all' | 'active' | 'completed' | 'escalated'>('all')
  const [replyText, setReplyText] = useState('')
  const [sending, setSending] = useState(false)
  
  // Filter conversations based on selected status
  const filteredConversations = filterStatus === 'all' 
    ? conversations 
    : conversations.filter(c => c.status === filterStatus)

  const handleSendReply = async () => {
    if (!selectedConvo || !replyText.trim()) return

    setSending(true)
    try {
      const response = await fetch(`/api/conversations/${selectedConvo.id}/reply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversationId: selectedConvo.id,
          message: replyText.trim(),
        }),
      })

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

  const handleUpdateStatus = async (conversationId: string, newStatus: string) => {
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
      <div className="grid gap-3 sm:gap-4 grid-cols-3 md:grid-cols-3">
        <button
          onClick={() => setFilterStatus('all')}
          className={`text-left transition-all ${
            filterStatus === 'all' ? 'ring-2 ring-primary' : ''
          }`}
        >
          <Card className="cursor-pointer hover:bg-muted/50">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 p-3 sm:p-4">
              <CardTitle className="text-xs sm:text-sm font-medium leading-tight">Total Conversations</CardTitle>
              <MessageSquare className="h-3 w-3 sm:h-4 sm:w-4 text-muted-foreground flex-shrink-0" />
            </CardHeader>
            <CardContent className="p-3 sm:p-4 pt-0">
              <div className="text-2xl sm:text-3xl font-bold">{conversations.length}</div>
              {filterStatus === 'all' && (
                <p className="text-xs text-muted-foreground mt-1">Showing all</p>
              )}
            </CardContent>
          </Card>
        </button>

        <button
          onClick={() => setFilterStatus('active')}
          className={`text-left transition-all ${
            filterStatus === 'active' ? 'ring-2 ring-primary' : ''
          }`}
        >
          <Card className="cursor-pointer hover:bg-muted/50">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 p-3 sm:p-4">
              <CardTitle className="text-xs sm:text-sm font-medium">Active</CardTitle>
              <Clock className="h-3 w-3 sm:h-4 sm:w-4 text-muted-foreground flex-shrink-0" />
            </CardHeader>
            <CardContent className="p-3 sm:p-4 pt-0">
              <div className="text-2xl sm:text-3xl font-bold">
                {conversations.filter((c) => c.status === 'active').length}
              </div>
              {filterStatus === 'active' && (
                <p className="text-xs text-muted-foreground mt-1">Filtered</p>
              )}
            </CardContent>
          </Card>
        </button>

        <button
          onClick={() => setFilterStatus('escalated')}
          className={`text-left transition-all ${
            filterStatus === 'escalated' ? 'ring-2 ring-primary' : ''
          }`}
        >
          <Card className="cursor-pointer hover:bg-muted/50">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 p-3 sm:p-4">
              <CardTitle className="text-xs sm:text-sm font-medium leading-tight">Need Attention</CardTitle>
              <AlertCircle className="h-3 w-3 sm:h-4 sm:w-4 text-muted-foreground flex-shrink-0" />
            </CardHeader>
            <CardContent className="p-3 sm:p-4 pt-0">
              <div className="text-2xl sm:text-3xl font-bold">
                {conversations.filter((c) => c.status === 'escalated').length}
              </div>
              {filterStatus === 'escalated' && (
                <p className="text-xs text-muted-foreground mt-1">Filtered</p>
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
            <div className="py-8 text-center text-muted-foreground">
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
                    className="w-full text-left rounded-lg border p-3 sm:p-4 hover:bg-muted transition-colors cursor-pointer"
                  >
                    <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2 sm:gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center flex-wrap gap-2 mb-1">
                          <a
                            href={`tel:${convo.phone_number}`}
                            className="font-medium text-blue-400 hover:underline text-sm sm:text-base"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {convo.phone_number}
                          </a>
                          {getStatusBadge(convo.status)}
                        </div>
                        {convo.lead?.name && (
                          <div className="text-xs sm:text-sm text-muted-foreground mb-1">
                            {convo.lead.name}
                          </div>
                        )}
                        {lastMessage && (
                          <div className="text-xs sm:text-sm text-muted-foreground line-clamp-2">
                            {lastMessage.role === 'user' ? '💬 ' : '🤖 '}
                            {lastMessage.content}
                          </div>
                        )}
                      </div>
                      <div className="flex sm:flex-col items-center sm:items-end gap-2 sm:gap-0 text-right">
                        <div className="text-xs text-muted-foreground whitespace-nowrap">
                          {formatTime(convo.updated_at)}
                        </div>
                        <div className="text-xs text-muted-foreground sm:mt-1">
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
          onClick={() => setSelectedConvo(null)}
        >
          <div
            className="bg-background rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="border-b p-4">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <a
                    href={`tel:${selectedConvo.phone_number}`}
                    className="text-lg font-semibold text-blue-400 hover:underline"
                  >
                    {selectedConvo.phone_number}
                  </a>
                  {getStatusBadge(selectedConvo.status)}
                </div>
                <Button variant="ghost" size="sm" onClick={() => setSelectedConvo(null)}>
                  <X className="h-4 w-4" />
                </Button>
              </div>
              {selectedConvo.lead && (
                <div className="text-sm text-muted-foreground mb-2">
                  Lead: {selectedConvo.lead.name} ({selectedConvo.lead.source})
                </div>
              )}
              <div className="text-xs text-muted-foreground mb-3">
                Started: {formatTime(selectedConvo.created_at)} • {selectedConvo.messages.length} messages
              </div>
              
              {/* Action Buttons */}
              <div className="flex gap-2">
                {selectedConvo.status !== 'completed' && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleUpdateStatus(selectedConvo.id, 'completed')}
                  >
                    <CheckCircle className="h-3 w-3 mr-1" />
                    Mark Complete
                  </Button>
                )}
                {selectedConvo.status === 'completed' && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleUpdateStatus(selectedConvo.id, 'active')}
                  >
                    Reopen
                  </Button>
                )}
                {selectedConvo.status !== 'escalated' && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleUpdateStatus(selectedConvo.id, 'escalated')}
                  >
                    <AlertCircle className="h-3 w-3 mr-1" />
                    Flag for Attention
                  </Button>
                )}
              </div>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
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
                        ? 'bg-red-100 text-red-800 text-xs'
                        : 'bg-muted'
                    }`}
                  >
                    <div className="whitespace-pre-wrap text-sm">{msg.content}</div>
                    <div
                      className={`text-xs mt-1 ${
                        msg.role === 'user' ? 'text-blue-100' : 'text-muted-foreground'
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
                  className="flex-1 min-h-[80px]"
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
                      <Send className="h-4 w-4 mr-1" />
                      Send
                    </>
                  )}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                Press Cmd/Ctrl + Enter to send
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
