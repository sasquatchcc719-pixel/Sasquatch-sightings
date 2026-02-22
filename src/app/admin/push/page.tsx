'use client'

import { useEffect, useState } from 'react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
import { Sparkles, Loader2, Send, Megaphone } from 'lucide-react'

const AUDIENCES = [
  { id: 'admin', label: 'Admin' },
  { id: 'business_card', label: 'Business card' },
  { id: 'vendor', label: 'Vendor (all)' },
  { id: 'contest', label: 'Contest' },
] as const

type AudienceId = (typeof AUDIENCES)[number]['id']

interface HistoryRow {
  id: string
  message_id: string
  audience: string
  title: string
  sent_at: string
  delivered: number
  opened: number
  open_rate: number | null
}

export default function AdminPushPage() {
  const [ramble, setRamble] = useState('')
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [audiences, setAudiences] = useState<AudienceId[]>([])
  const [isGenerating, setIsGenerating] = useState(false)
  const [isSending, setIsSending] = useState(false)
  const [sendResults, setSendResults] = useState<
    Array<{ audience: string; delivered: number; opened: number }>
  >([])
  const [historyDays, setHistoryDays] = useState(30)
  const [historyAudience, setHistoryAudience] = useState<string>('')
  const [history, setHistory] = useState<HistoryRow[]>([])
  const [historyLoading, setHistoryLoading] = useState(true)

  const loadHistory = async () => {
    setHistoryLoading(true)
    try {
      const params = new URLSearchParams({ days: String(historyDays) })
      if (historyAudience) params.set('audience', historyAudience)
      const res = await fetch(`/api/admin/push/history?${params}`)
      const data = await res.json()
      if (res.ok) setHistory(data.list ?? [])
    } catch {
      setHistory([])
    } finally {
      setHistoryLoading(false)
    }
  }

  useEffect(() => {
    let cancelled = false
    setHistoryLoading(true)
    const params = new URLSearchParams({ days: String(historyDays) })
    if (historyAudience) params.set('audience', historyAudience)
    fetch(`/api/admin/push/history?${params}`)
      .then((res) => res.json())
      .then((data) => {
        if (!cancelled && data.list) setHistory(data.list)
      })
      .catch(() => {
        if (!cancelled) setHistory([])
      })
      .finally(() => {
        if (!cancelled) setHistoryLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [historyDays, historyAudience])

  const handleGenerate = async () => {
    setIsGenerating(true)
    setSendResults([])
    try {
      const res = await fetch('/api/admin/push/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ramble: ramble.trim() || undefined }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Generate failed')
      setTitle(data.title ?? '')
      setBody(data.body ?? '')
    } catch (e) {
      console.error(e)
      alert(e instanceof Error ? e.message : 'Failed to generate')
    } finally {
      setIsGenerating(false)
    }
  }

  const toggleAudience = (id: AudienceId) => {
    setAudiences((prev) =>
      prev.includes(id) ? prev.filter((a) => a !== id) : [...prev, id],
    )
  }

  const selectAllAudiences = () => {
    if (audiences.length === AUDIENCES.length) {
      setAudiences([])
    } else {
      setAudiences(AUDIENCES.map((a) => a.id))
    }
  }

  const handleSend = async () => {
    if (!title.trim() || !body.trim()) {
      alert('Please add a title and body.')
      return
    }
    if (audiences.length === 0) {
      alert('Please select at least one audience.')
      return
    }
    setIsSending(true)
    setSendResults([])
    try {
      const res = await fetch('/api/admin/push/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          body: body.trim(),
          audiences,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Send failed')
      setSendResults(data.results ?? [])
      loadHistory()
    } catch (e) {
      console.error(e)
      alert(e instanceof Error ? e.message : 'Failed to send')
    } finally {
      setIsSending(false)
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-8 p-4">
      <div className="flex items-center gap-2">
        <Megaphone className="h-8 w-8 text-green-500" />
        <h1 className="text-2xl font-bold">Push notifications</h1>
      </div>

      <Card className="p-6">
        <h2 className="mb-4 text-lg font-semibold">Compose</h2>
        <div className="space-y-4">
          <div>
            <Label htmlFor="ramble">Ramble (what you want to say)</Label>
            <Textarea
              id="ramble"
              value={ramble}
              onChange={(e) => setRamble(e.target.value)}
              placeholder="Type or paste your message idea here..."
              rows={4}
              className="mt-1 resize-none"
            />
          </div>
          <Button
            type="button"
            onClick={handleGenerate}
            disabled={isGenerating}
            variant="secondary"
            size="sm"
          >
            {isGenerating ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Generating...
              </>
            ) : (
              <>
                <Sparkles className="mr-2 h-4 w-4" />
                Generate title & body
              </>
            )}
          </Button>
          <div>
            <Label htmlFor="title">Title</Label>
            <Input
              id="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Push notification title"
              className="mt-1"
            />
          </div>
          <div>
            <Label htmlFor="body">Body</Label>
            <Textarea
              id="body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Push notification body"
              rows={3}
              className="mt-1 resize-none"
            />
          </div>
        </div>
      </Card>

      <Card className="p-6">
        <h2 className="mb-4 text-lg font-semibold">Audience</h2>
        <p className="text-muted-foreground mb-3 text-sm">
          Choose who receives this push. Same message goes to all selected.
        </p>
        <div className="flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-2 text-sm font-medium">
            <Checkbox
              checked={audiences.length === AUDIENCES.length}
              onCheckedChange={selectAllAudiences}
            />
            Select all
          </label>
          {AUDIENCES.map(({ id, label }) => (
            <label
              key={id}
              className="flex cursor-pointer items-center gap-2 text-sm"
            >
              <Checkbox
                checked={audiences.includes(id)}
                onCheckedChange={() => toggleAudience(id)}
              />
              {label}
            </label>
          ))}
        </div>
        <div className="mt-4">
          <Button
            type="button"
            onClick={handleSend}
            disabled={
              isSending ||
              !title.trim() ||
              !body.trim() ||
              audiences.length === 0
            }
          >
            {isSending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Sending...
              </>
            ) : (
              <>
                <Send className="mr-2 h-4 w-4" />
                Send to {audiences.length} audience
                {audiences.length !== 1 ? 's' : ''}
              </>
            )}
          </Button>
        </div>
        {sendResults.length > 0 && (
          <div className="bg-muted/50 mt-4 rounded-md border p-3 text-sm">
            <p className="font-medium">Sent:</p>
            <ul className="mt-1 list-inside list-disc space-y-0.5">
              {sendResults.map((r) => (
                <li key={r.audience}>
                  {r.audience}: {r.delivered} delivered, {r.opened} opened
                </li>
              ))}
            </ul>
          </div>
        )}
      </Card>

      <Card className="p-6">
        <h2 className="mb-4 text-lg font-semibold">History</h2>
        <div className="mb-4 flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2">
            <Label htmlFor="days" className="text-sm">
              Last
            </Label>
            <select
              id="days"
              value={historyDays}
              onChange={(e) => setHistoryDays(Number(e.target.value))}
              className="bg-background rounded border px-2 py-1 text-sm"
            >
              <option value={7}>7 days</option>
              <option value={30}>30 days</option>
              <option value={90}>90 days</option>
            </select>
          </div>
          <div className="flex items-center gap-2">
            <Label htmlFor="filter-audience" className="text-sm">
              Category
            </Label>
            <select
              id="filter-audience"
              value={historyAudience}
              onChange={(e) => setHistoryAudience(e.target.value)}
              className="bg-background rounded border px-2 py-1 text-sm"
            >
              <option value="">All</option>
              {AUDIENCES.map(({ id, label }) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
          </div>
        </div>
        {historyLoading ? (
          <p className="text-muted-foreground text-sm">Loading...</p>
        ) : history.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            No sends in this period.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="pb-2 text-left font-medium">Date</th>
                  <th className="pb-2 text-left font-medium">Title</th>
                  <th className="pb-2 text-left font-medium">Category</th>
                  <th className="pb-2 text-right font-medium">Delivered</th>
                  <th className="pb-2 text-right font-medium">Opened</th>
                  <th className="pb-2 text-right font-medium">Rate</th>
                </tr>
              </thead>
              <tbody>
                {history.map((row) => (
                  <tr key={row.id} className="border-b last:border-0">
                    <td className="py-2">
                      {new Date(row.sent_at).toLocaleDateString(undefined, {
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </td>
                    <td
                      className="max-w-[200px] truncate py-2"
                      title={row.title}
                    >
                      {row.title}
                    </td>
                    <td className="py-2">{row.audience}</td>
                    <td className="py-2 text-right">{row.delivered}</td>
                    <td className="py-2 text-right">{row.opened}</td>
                    <td className="py-2 text-right">
                      {row.open_rate != null ? `${row.open_rate}%` : '–'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}
