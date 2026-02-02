'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import {
  MessageSquare,
  Plus,
  Pause,
  Play,
  Trash2,
  Edit2,
  X,
  Check,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card } from '@/components/ui/card'

interface Target {
  id: string
  type: string
  value: string
  source: string
  url: string | null
  notes: string | null
  is_active: boolean
  created_at: string
}

// Parse natural language into structured target
function parseTargetInput(
  input: string,
): { type: string; value: string; source: string } | null {
  const lowered = input.toLowerCase()

  // Competitor patterns
  if (
    lowered.includes('watch') ||
    lowered.includes('monitor') ||
    lowered.includes('track')
  ) {
    // "Watch Oxi Fresh on Google"
    const compMatch = input.match(
      /(?:watch|monitor|track)\s+([^on]+)\s+(?:on|reviews?|from)\s+(\w+)/i,
    )
    if (compMatch) {
      return {
        type: 'competitor',
        value: compMatch[1].trim(),
        source: normalizeSource(compMatch[2]),
      }
    }
  }

  // Keyword patterns
  if (lowered.includes('keyword') || lowered.includes('search')) {
    const kwMatch = input.match(/(?:keyword|search)[:\s]+["']?([^"']+)["']?/i)
    if (kwMatch) {
      return {
        type: 'keyword',
        value: kwMatch[1].trim(),
        source: 'google',
      }
    }
  }

  // Quote patterns - assume keyword search
  const quoteMatch = input.match(/["']([^"']+)["']/)
  if (quoteMatch) {
    return {
      type: 'keyword',
      value: quoteMatch[1],
      source: 'google',
    }
  }

  // Default: treat as competitor on Google
  if (input.trim().length > 0) {
    return {
      type: 'competitor',
      value: input.trim(),
      source: 'gbp',
    }
  }

  return null
}

function normalizeSource(source: string): string {
  const s = source.toLowerCase()
  if (s.includes('google') || s === 'gbp') return 'gbp'
  if (s.includes('yelp')) return 'yelp'
  if (s.includes('reddit')) return 'reddit'
  if (s.includes('website') || s.includes('site')) return 'website'
  return 'google'
}

function getSourceLabel(source: string): string {
  switch (source) {
    case 'gbp':
      return 'Google Business Profile'
    case 'google':
      return 'Google Search'
    case 'yelp':
      return 'Yelp'
    case 'reddit':
      return 'Reddit'
    case 'website':
      return 'Website'
    default:
      return source
  }
}

function getTypeLabel(type: string): string {
  switch (type) {
    case 'competitor':
      return 'Competitor'
    case 'keyword':
      return 'Keyword'
    case 'location':
      return 'Location'
    case 'subreddit':
      return 'Subreddit'
    default:
      return type
  }
}

export default function TargetsPage() {
  const [targets, setTargets] = useState<Target[]>([])
  const [loading, setLoading] = useState(true)
  const [newTarget, setNewTarget] = useState('')
  const [adding, setAdding] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')

  // Fetch targets
  useEffect(() => {
    fetchTargets()
  }, [])

  async function fetchTargets() {
    try {
      const res = await fetch('/api/analyst/targets')
      const data = await res.json()
      setTargets(data.targets || [])
    } catch (error) {
      console.error('Failed to fetch targets:', error)
    } finally {
      setLoading(false)
    }
  }

  async function addTarget() {
    if (!newTarget.trim()) return

    const parsed = parseTargetInput(newTarget)
    if (!parsed) {
      alert(
        'Could not understand that. Try: "Watch Oxi Fresh on Google" or "keyword: carpet cleaning monument"',
      )
      return
    }

    setAdding(true)
    try {
      const res = await fetch('/api/analyst/targets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(parsed),
      })

      if (res.ok) {
        setNewTarget('')
        fetchTargets()
      }
    } catch (error) {
      console.error('Failed to add target:', error)
    } finally {
      setAdding(false)
    }
  }

  async function toggleActive(target: Target) {
    try {
      await fetch('/api/analyst/targets', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: target.id, is_active: !target.is_active }),
      })
      fetchTargets()
    } catch (error) {
      console.error('Failed to toggle target:', error)
    }
  }

  async function deleteTarget(id: string) {
    if (!confirm('Delete this target?')) return

    try {
      await fetch(`/api/analyst/targets?id=${id}`, { method: 'DELETE' })
      fetchTargets()
    } catch (error) {
      console.error('Failed to delete target:', error)
    }
  }

  async function saveEdit(target: Target) {
    if (!editValue.trim()) {
      setEditingId(null)
      return
    }

    try {
      await fetch('/api/analyst/targets', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: target.id, value: editValue }),
      })
      setEditingId(null)
      fetchTargets()
    } catch (error) {
      console.error('Failed to update target:', error)
    }
  }

  const activeTargets = targets.filter((t) => t.is_active)
  const pausedTargets = targets.filter((t) => !t.is_active)

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">
            Market Intel Targets
          </h1>
          <p className="text-white/60">Configure what Harry should watch</p>
        </div>
        <Button
          asChild
          variant="outline"
          className="border-white/20 bg-white/10 text-white hover:bg-white/20"
        >
          <Link href="/admin/analyst">
            <MessageSquare className="mr-2 h-4 w-4" />
            Chat with Harry
          </Link>
        </Button>
      </div>

      {/* Add Target */}
      <Card className="border-white/20 bg-black/40 p-4">
        <label className="mb-2 block text-sm font-medium text-white/80">
          Add new target:
        </label>
        <div className="flex gap-2">
          <Input
            value={newTarget}
            onChange={(e) => setNewTarget(e.target.value)}
            placeholder='e.g. "Watch Oxi Fresh reviews on Google" or "carpet cleaning monument co"'
            className="flex-1 border-white/20 bg-black/40 text-white placeholder:text-white/40"
            onKeyDown={(e) => e.key === 'Enter' && addTarget()}
          />
          <Button
            onClick={addTarget}
            disabled={adding || !newTarget.trim()}
            className="bg-green-600 hover:bg-green-700"
          >
            <Plus className="mr-2 h-4 w-4" />
            Add Target
          </Button>
        </div>
        <p className="mt-2 text-xs text-white/50">
          Harry will parse natural language. Try: &quot;Watch Oxi Fresh on
          Google&quot; or &quot;keyword: carpet cleaning monument&quot;
        </p>
      </Card>

      {/* Loading */}
      {loading && (
        <div className="py-8 text-center text-white/60">Loading targets...</div>
      )}

      {/* Active Targets */}
      {!loading && activeTargets.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-lg font-semibold text-white">
            Active Targets ({activeTargets.length})
          </h2>
          {activeTargets.map((target) => (
            <Card key={target.id} className="border-white/20 bg-black/40 p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-3">
                  <div className="mt-1 h-3 w-3 rounded-full bg-green-500" />
                  <div>
                    {editingId === target.id ? (
                      <div className="flex items-center gap-2">
                        <Input
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          className="h-8 w-64 border-white/20 bg-black/40 text-white"
                          autoFocus
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') saveEdit(target)
                            if (e.key === 'Escape') setEditingId(null)
                          }}
                        />
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => saveEdit(target)}
                        >
                          <Check className="h-4 w-4 text-green-400" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setEditingId(null)}
                        >
                          <X className="h-4 w-4 text-white/60" />
                        </Button>
                      </div>
                    ) : (
                      <div className="text-lg font-medium text-white">
                        {target.value}
                      </div>
                    )}
                    <div className="mt-1 flex gap-3 text-sm text-white/60">
                      <span>Source: {getSourceLabel(target.source)}</span>
                      <span>Type: {getTypeLabel(target.type)}</span>
                    </div>
                    {target.notes && (
                      <div className="mt-1 text-sm text-white/50">
                        {target.notes}
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setEditingId(target.id)
                      setEditValue(target.value)
                    }}
                    className="text-white/60 hover:text-white"
                  >
                    <Edit2 className="h-4 w-4" />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => toggleActive(target)}
                    className="text-amber-400 hover:text-amber-300"
                  >
                    <Pause className="h-4 w-4" />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => deleteTarget(target.id)}
                    className="text-red-400 hover:text-red-300"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Paused Targets */}
      {!loading && pausedTargets.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-lg font-semibold text-white/60">
            Paused ({pausedTargets.length})
          </h2>
          {pausedTargets.map((target) => (
            <Card
              key={target.id}
              className="border-white/10 bg-black/20 p-4 opacity-60"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-3">
                  <div className="mt-1 h-3 w-3 rounded-full bg-white/30" />
                  <div>
                    <div className="text-lg font-medium text-white/70">
                      {target.value}
                    </div>
                    <div className="mt-1 flex gap-3 text-sm text-white/40">
                      <span>Source: {getSourceLabel(target.source)}</span>
                      <span>Type: {getTypeLabel(target.type)}</span>
                    </div>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => toggleActive(target)}
                    className="text-green-400 hover:text-green-300"
                  >
                    <Play className="h-4 w-4" />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => deleteTarget(target.id)}
                    className="text-red-400 hover:text-red-300"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Empty State */}
      {!loading && targets.length === 0 && (
        <Card className="border-white/20 bg-black/40 p-8 text-center">
          <div className="text-4xl">🎯</div>
          <h3 className="mt-4 text-lg font-medium text-white">
            No targets yet
          </h3>
          <p className="mt-2 text-white/60">
            Add your first target above to start gathering market intelligence.
          </p>
        </Card>
      )}
    </div>
  )
}
