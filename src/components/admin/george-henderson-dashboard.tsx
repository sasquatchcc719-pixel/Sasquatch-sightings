'use client'

import { useEffect, useMemo, useState } from 'react'
import { Bot, Check, Loader2, RefreshCw, Send, X } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import type { GeorgeChatResponse } from '@/lib/george/contracts'

type Message = {
  role: 'user' | 'assistant'
  content: string
}

type RecentAction = {
  id: string
  action_name: string
  status: string
  target: string | null
  reason: string | null
  actor_email: string | null
  created_at: string
  error_message: string | null
}

type GeorgeStatus = {
  enabled: boolean
  rollout_mode: 'read_only' | 'confirm_actions'
  model: string
  recent_actions: RecentAction[]
}

const INITIAL_ASSISTANT_MESSAGE: Message = {
  role: 'assistant',
  content:
    "I'm George Henderson. I can inspect operations state and propose safe, confirm-required changes.",
}

export function GeorgeHendersonDashboard() {
  const [status, setStatus] = useState<GeorgeStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [input, setInput] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [messages, setMessages] = useState<Message[]>([
    INITIAL_ASSISTANT_MESSAGE,
  ])
  const [pendingConfirmation, setPendingConfirmation] =
    useState<GeorgeChatResponse['confirmation']>(undefined)

  async function loadStatus() {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch('/api/admin/george', { cache: 'no-store' })
      const result = await response.json()
      if (!response.ok) {
        throw new Error(result.error || 'Failed to load George status')
      }
      setStatus(result as GeorgeStatus)
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : 'Failed to load George status',
      )
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadStatus()
  }, [])

  const canRunActions = useMemo(
    () => status?.rollout_mode === 'confirm_actions',
    [status?.rollout_mode],
  )

  async function sendMessage() {
    if (!input.trim() || sending) return
    const prompt = input.trim()
    setInput('')
    setSending(true)
    setError(null)
    setMessages((current) => [...current, { role: 'user', content: prompt }])

    try {
      const response = await fetch('/api/admin/george', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: prompt }),
      })
      const result = (await response.json()) as GeorgeChatResponse
      if (!response.ok) {
        throw new Error(result.assistant_message || 'George request failed')
      }

      setMessages((current) => [
        ...current,
        { role: 'assistant', content: result.assistant_message },
      ])
      setPendingConfirmation(result.confirmation)
      await loadStatus()
    } catch (sendError) {
      setError(
        sendError instanceof Error
          ? sendError.message
          : 'Failed to send message to George',
      )
    } finally {
      setSending(false)
    }
  }

  async function executeConfirmation() {
    if (!pendingConfirmation?.token || sending) return
    setSending(true)
    setError(null)
    try {
      const response = await fetch('/api/admin/george', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmation_token: pendingConfirmation.token }),
      })
      const result = (await response.json()) as GeorgeChatResponse
      if (!response.ok) {
        throw new Error(result.assistant_message || 'Confirmation failed')
      }
      setMessages((current) => [
        ...current,
        { role: 'assistant', content: result.assistant_message },
      ])
      setPendingConfirmation(undefined)
      await loadStatus()
    } catch (confirmError) {
      setError(
        confirmError instanceof Error
          ? confirmError.message
          : 'Failed to confirm action',
      )
    } finally {
      setSending(false)
    }
  }

  function cancelConfirmation() {
    setPendingConfirmation(undefined)
    setMessages((current) => [
      ...current,
      {
        role: 'assistant',
        content: 'Action canceled. No changes were executed.',
      },
    ])
  }

  if (loading && !status) {
    return (
      <div className="flex items-center gap-2 text-sm">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading George Henderson...
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <Card className="border-border/60 bg-card/80 p-6 shadow-sm backdrop-blur">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-2xl font-semibold">George Henderson</h2>
            <p className="text-muted-foreground mt-1 text-sm">
              Smart field operations copilot for Harry controls, conversation
              handling, and Twilio routing adjustments.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant={canRunActions ? 'default' : 'secondary'}>
              {canRunActions ? 'Confirm Actions Mode' : 'Read-Only Mode'}
            </Badge>
            <Badge variant="outline">{status?.model || 'Unknown model'}</Badge>
            <Button variant="outline" onClick={() => void loadStatus()}>
              <RefreshCw className="mr-2 h-4 w-4" />
              Refresh
            </Button>
          </div>
        </div>
      </Card>

      {error ? (
        <Card className="border-destructive/30 bg-destructive/10 text-destructive p-4 text-sm">
          {error}
        </Card>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[1.7fr_1fr]">
        <Card className="border-border/60 bg-card/80 flex min-h-[560px] flex-col p-4 shadow-sm backdrop-blur">
          <div className="mb-3 flex items-center gap-2">
            <Bot className="h-4 w-4" />
            <p className="text-sm font-semibold">Field Chat</p>
          </div>

          <div className="mb-4 flex-1 space-y-3 overflow-y-auto pr-1">
            {messages.map((message, index) => (
              <div
                key={`${message.role}-${index}`}
                className={`rounded-xl border p-3 text-sm ${
                  message.role === 'assistant'
                    ? 'border-border/60 bg-muted/30'
                    : 'border-emerald-500/30 bg-emerald-500/10'
                }`}
              >
                <p className="mb-1 text-xs font-semibold uppercase">
                  {message.role === 'assistant' ? 'George' : 'You'}
                </p>
                <p className="whitespace-pre-wrap">{message.content}</p>
              </div>
            ))}
          </div>

          {pendingConfirmation ? (
            <div className="mb-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3">
              <p className="mb-1 text-sm font-semibold">
                Confirmation Required
              </p>
              <p className="text-sm">{pendingConfirmation.summary}</p>
              <p className="text-muted-foreground mt-1 text-xs">
                Expires:{' '}
                {new Date(pendingConfirmation.expires_at).toLocaleString()}
              </p>
              <div className="mt-3 flex gap-2">
                <Button
                  onClick={() => void executeConfirmation()}
                  disabled={sending || !canRunActions}
                >
                  <Check className="mr-2 h-4 w-4" />
                  Confirm Action
                </Button>
                <Button variant="outline" onClick={cancelConfirmation}>
                  <X className="mr-2 h-4 w-4" />
                  Cancel
                </Button>
              </div>
            </div>
          ) : null}

          <div className="space-y-2">
            <Textarea
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder="Ask George to inspect or propose a change..."
              rows={3}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault()
                  void sendMessage()
                }
              }}
            />
            <div className="flex justify-end">
              <Button onClick={() => void sendMessage()} disabled={sending}>
                {sending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Send className="mr-2 h-4 w-4" />
                )}
                Send
              </Button>
            </div>
          </div>
        </Card>

        <Card className="border-border/60 bg-card/80 p-4 shadow-sm backdrop-blur">
          <p className="mb-3 text-sm font-semibold">Recent George Actions</p>
          <div className="space-y-2">
            {(status?.recent_actions || []).length === 0 ? (
              <p className="text-muted-foreground text-sm">
                No George actions recorded yet.
              </p>
            ) : (
              (status?.recent_actions || []).map((item) => (
                <div
                  key={item.id}
                  className="border-border/60 rounded-lg border p-2 text-xs"
                >
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <span className="font-semibold">{item.action_name}</span>
                    <Badge variant="outline">{item.status}</Badge>
                  </div>
                  <p className="text-muted-foreground">
                    {item.target || 'n/a'}
                  </p>
                  <p className="text-muted-foreground">
                    {new Date(item.created_at).toLocaleString()}
                  </p>
                  {item.error_message ? (
                    <p className="text-destructive mt-1">
                      {item.error_message}
                    </p>
                  ) : null}
                </div>
              ))
            )}
          </div>
        </Card>
      </div>
    </div>
  )
}
