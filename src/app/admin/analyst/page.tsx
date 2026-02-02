'use client'

import { useState, useRef, useEffect } from 'react'
import Link from 'next/link'
import { Target, Send, Loader2, Radar, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'

interface Message {
  role: 'user' | 'assistant'
  content: string
}

const INITIAL_MESSAGE: Message = {
  role: 'assistant',
  content:
    "Hey, it's Harry. I remember our past conversations. Ask me anything about the business or competitors.",
}

export default function AnalystChatPage() {
  const [messages, setMessages] = useState<Message[]>([INITIAL_MESSAGE])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [historyLoaded, setHistoryLoaded] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  // Load conversation history on mount
  useEffect(() => {
    async function loadHistory() {
      try {
        const res = await fetch('/api/analyst/history')
        const data = await res.json()

        if (data.messages && data.messages.length > 0) {
          setMessages(
            data.messages.map((m: { role: string; content: string }) => ({
              role: m.role as 'user' | 'assistant',
              content: m.content,
            })),
          )
        }
      } catch (error) {
        console.error('Failed to load history:', error)
      } finally {
        setHistoryLoaded(true)
      }
    }

    loadHistory()
  }, [])

  // Clear conversation history
  async function clearHistory() {
    if (!confirm('Clear all conversation history with Harry?')) return

    try {
      await fetch('/api/analyst/history', { method: 'DELETE' })
      setMessages([INITIAL_MESSAGE])
    } catch (error) {
      console.error('Failed to clear history:', error)
    }
  }

  // Run competitor scan
  async function runScan() {
    if (scanning) return

    setScanning(true)
    setMessages((prev) => [
      ...prev,
      { role: 'user', content: '🔍 Run competitor scan' },
      {
        role: 'assistant',
        content:
          "Scanning competitors... This takes a minute. I'm searching Google, reading their sites, and analyzing what I find.",
      },
    ])

    try {
      const res = await fetch('/api/analyst/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })

      const data = await res.json()

      if (data.error) {
        setMessages((prev) => [
          ...prev,
          {
            role: 'assistant',
            content: `Scan failed: ${data.error}${data.hint ? `\n\nHint: ${data.hint}` : ''}`,
          },
        ])
      } else {
        const summary = data.results
          .filter((r: { success: boolean }) => r.success)
          .map(
            (r: { competitor: string; analysis?: { keyFindings?: string } }) =>
              `**${r.competitor}**: ${r.analysis?.keyFindings || 'No new findings'}`,
          )
          .join('\n\n')

        setMessages((prev) => [
          ...prev,
          {
            role: 'assistant',
            content: `Done. ${data.message}\n\n${summary}\n\nAsk me anything about what I found.`,
          },
        ])
      }
    } catch (error) {
      console.error('Scan error:', error)
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: 'Scan failed. Check console for details.',
        },
      ])
    } finally {
      setScanning(false)
    }
  }

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Focus input on load
  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  async function sendMessage() {
    if (!input.trim() || loading) return

    const userMessage = input.trim()
    setInput('')
    setMessages((prev) => [...prev, { role: 'user', content: userMessage }])
    setLoading(true)

    try {
      const res = await fetch('/api/analyst/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: userMessage,
          conversationHistory: messages,
        }),
      })

      const data = await res.json()

      if (data.error) {
        setMessages((prev) => [
          ...prev,
          { role: 'assistant', content: `Error: ${data.error}` },
        ])
      } else {
        setMessages((prev) => [
          ...prev,
          { role: 'assistant', content: data.message },
        ])
      }
    } catch (error) {
      console.error('Chat error:', error)
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: 'Something went wrong. Try again.' },
      ])
    } finally {
      setLoading(false)
      inputRef.current?.focus()
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  return (
    <div className="relative flex h-[calc(100vh-280px)] min-h-[500px] flex-col">
      {/* Header */}
      <div className="relative z-10 mb-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-green-600 text-xl">
            🦶
          </div>
          <div>
            <h1 className="text-xl font-bold text-white">
              Harry - Sasquatch Analyst
            </h1>
            <p className="text-sm text-white/60">
              Business intel + competitor research
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button
            onClick={runScan}
            disabled={scanning}
            variant="outline"
            className="border-amber-500/50 bg-amber-500/20 text-amber-300 hover:bg-amber-500/30"
          >
            {scanning ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Scanning...
              </>
            ) : (
              <>
                <Radar className="mr-2 h-4 w-4" />
                Scan
              </>
            )}
          </Button>
          <Button
            onClick={clearHistory}
            variant="outline"
            className="border-red-500/30 bg-red-500/10 text-red-300 hover:bg-red-500/20"
            title="Clear conversation history"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
          <Button
            asChild
            variant="outline"
            className="border-white/20 bg-white/10 text-white hover:bg-white/20"
          >
            <Link href="/admin/analyst/targets">
              <Target className="mr-2 h-4 w-4" />
              Targets
            </Link>
          </Button>
        </div>
      </div>

      {/* Chat Messages */}
      <Card className="relative z-10 flex-1 overflow-hidden border-white/20 bg-black/40">
        <div className="h-full overflow-y-auto p-4">
          <div className="space-y-4">
            {messages.map((msg, i) => (
              <div
                key={i}
                className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[85%] rounded-2xl px-4 py-3 ${
                    msg.role === 'user'
                      ? 'bg-green-600 text-white'
                      : 'bg-white/10 text-white'
                  }`}
                >
                  {msg.role === 'assistant' && (
                    <div className="mb-1 text-xs font-medium text-green-400">
                      Harry
                    </div>
                  )}
                  <div className="text-sm leading-relaxed whitespace-pre-wrap">
                    {msg.content}
                  </div>
                </div>
              </div>
            ))}
            {loading && (
              <div className="flex justify-start">
                <div className="rounded-2xl bg-white/10 px-4 py-3">
                  <div className="mb-1 text-xs font-medium text-green-400">
                    Harry
                  </div>
                  <div className="flex items-center gap-2 text-white/60">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Thinking...
                  </div>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
        </div>
      </Card>

      {/* Input */}
      <div className="relative z-10 mt-4">
        <div className="flex gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask Harry anything..."
            rows={2}
            className="flex-1 resize-none rounded-xl border border-white/20 bg-black/40 px-4 py-3 text-white placeholder:text-white/40 focus:border-green-500 focus:ring-1 focus:ring-green-500 focus:outline-none"
          />
          <Button
            onClick={sendMessage}
            disabled={loading || !input.trim()}
            className="h-auto bg-green-600 px-6 hover:bg-green-700"
          >
            <Send className="h-5 w-5" />
          </Button>
        </div>
        <p className="mt-2 text-center text-xs text-white/40">
          Press Enter to send, Shift+Enter for new line
        </p>
      </div>
    </div>
  )
}
