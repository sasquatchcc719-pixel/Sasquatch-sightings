'use client'

import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { MessageSquare, Phone, AlertCircle, CheckCircle, Clock } from 'lucide-react'

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
  const [selectedConvo, setSelectedConvo] = useState<Conversation | null>(null)

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
    return new Date(timestamp).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    })
  }

  return (
    <div className="space-y-4">
      {/* Stats */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Conversations</CardTitle>
            <MessageSquare className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{conversations.length}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active</CardTitle>
            <Clock className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">
              {conversations.filter((c) => c.status === 'active').length}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Need Attention</CardTitle>
            <AlertCircle className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">
              {conversations.filter((c) => c.status === 'escalated').length}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Conversations List */}
      <Card>
        <CardHeader>
          <CardTitle>Conversations</CardTitle>
          <CardDescription>
            {conversations.length === 0
              ? 'No conversations yet'
              : 'Click a conversation to view full message history'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {conversations.length === 0 ? (
            <div className="py-8 text-center text-muted-foreground">
              No conversations yet. When customers text your Twilio number, they&apos;ll appear here.
            </div>
          ) : (
            <div className="space-y-2">
              {conversations.map((convo) => {
                const messageCount = convo.messages.length
                const lastMessage = convo.messages[messageCount - 1]

                return (
                  <button
                    key={convo.id}
                    onClick={() => setSelectedConvo(convo)}
                    className="w-full text-left rounded-lg border p-4 hover:bg-muted transition-colors"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <a
                            href={`tel:${convo.phone_number}`}
                            className="font-medium text-blue-400 hover:underline"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {convo.phone_number}
                          </a>
                          {getStatusBadge(convo.status)}
                        </div>
                        {convo.lead?.name && (
                          <div className="text-sm text-muted-foreground mb-1">
                            {convo.lead.name}
                          </div>
                        )}
                        {lastMessage && (
                          <div className="text-sm text-muted-foreground truncate">
                            {lastMessage.role === 'user' ? '💬 ' : '🤖 '}
                            {lastMessage.content}
                          </div>
                        )}
                      </div>
                      <div className="text-right">
                        <div className="text-xs text-muted-foreground">
                          {formatTime(convo.updated_at)}
                        </div>
                        <div className="text-xs text-muted-foreground mt-1">
                          {messageCount} messages
                        </div>
                      </div>
                    </div>
                  </button>
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
                  Close
                </Button>
              </div>
              {selectedConvo.lead && (
                <div className="text-sm text-muted-foreground">
                  Lead: {selectedConvo.lead.name} ({selectedConvo.lead.source})
                </div>
              )}
              <div className="text-xs text-muted-foreground">
                Started: {formatTime(selectedConvo.created_at)} • {selectedConvo.messages.length} messages
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
          </div>
        </div>
      )}
    </div>
  )
}
