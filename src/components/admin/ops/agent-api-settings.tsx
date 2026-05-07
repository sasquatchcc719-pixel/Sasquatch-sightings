'use client'

import { useEffect, useState } from 'react'
import { Loader2, Plus, Copy, Trash2, Key, Bot, Gift } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'

type AgentKey = {
  id: string
  label: string
  booking_mode: string
  is_active: boolean
  created_at: string
}

type AgentSettings = {
  ai_agent_api_enabled: boolean
  ai_agent_promo_enabled: boolean
  ai_agent_promo_discount: number
  ai_agent_promo_minimum: number
}

export function AgentApiSettings() {
  const [loading, setLoading] = useState(true)
  const [settings, setSettings] = useState<AgentSettings | null>(null)
  const [keys, setKeys] = useState<AgentKey[]>([])
  const [toggling, setToggling] = useState(false)
  const [showNewKey, setShowNewKey] = useState(false)
  const [newKeyLabel, setNewKeyLabel] = useState('')
  const [newKeyMode, setNewKeyMode] = useState<'request' | 'direct'>('request')
  const [creating, setCreating] = useState(false)
  const [revealedKey, setRevealedKey] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [savingPromo, setSavingPromo] = useState(false)
  const [promoDiscount, setPromoDiscount] = useState('')
  const [promoMinimum, setPromoMinimum] = useState('')

  async function load() {
    setLoading(true)
    try {
      const res = await fetch('/api/admin/agent-settings', {
        cache: 'no-store',
      })
      const data = await res.json()
      if (data.settings) {
        setSettings(data.settings)
        setPromoDiscount(String(data.settings.ai_agent_promo_discount))
        setPromoMinimum(String(data.settings.ai_agent_promo_minimum))
      }
      if (data.keys) setKeys(data.keys)
    } catch {
      // non-fatal
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  async function handleToggleApi() {
    if (!settings) return
    setToggling(true)
    try {
      const res = await fetch('/api/admin/agent-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'update_settings',
          ai_agent_api_enabled: !settings.ai_agent_api_enabled,
        }),
      })
      if (res.ok) {
        setSettings((prev) =>
          prev
            ? { ...prev, ai_agent_api_enabled: !prev.ai_agent_api_enabled }
            : prev,
        )
      }
    } finally {
      setToggling(false)
    }
  }

  async function handleTogglePromo() {
    if (!settings) return
    const res = await fetch('/api/admin/agent-settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'update_settings',
        ai_agent_promo_enabled: !settings.ai_agent_promo_enabled,
      }),
    })
    if (res.ok) {
      setSettings((prev) =>
        prev
          ? { ...prev, ai_agent_promo_enabled: !prev.ai_agent_promo_enabled }
          : prev,
      )
    }
  }

  async function handleSavePromo() {
    setSavingPromo(true)
    try {
      const res = await fetch('/api/admin/agent-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'update_settings',
          ai_agent_promo_discount: parseFloat(promoDiscount),
          ai_agent_promo_minimum: parseFloat(promoMinimum),
        }),
      })
      if (res.ok) {
        setSettings((prev) =>
          prev
            ? {
                ...prev,
                ai_agent_promo_discount: parseFloat(promoDiscount),
                ai_agent_promo_minimum: parseFloat(promoMinimum),
              }
            : prev,
        )
      }
    } finally {
      setSavingPromo(false)
    }
  }

  async function handleCreateKey() {
    setCreating(true)
    try {
      const res = await fetch('/api/admin/agent-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create_key',
          label: newKeyLabel || 'Unnamed',
          booking_mode: newKeyMode,
        }),
      })
      const data = await res.json()
      if (data.api_key) {
        setRevealedKey(data.api_key)
        setNewKeyLabel('')
        setShowNewKey(false)
        void load()
      }
    } finally {
      setCreating(false)
    }
  }

  async function handleRevokeKey(keyId: string) {
    if (!confirm('Revoke this API key? AI agents using it will lose access.'))
      return
    await fetch('/api/admin/agent-settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'revoke_key', key_id: keyId }),
    })
    void load()
  }

  async function handleDeleteKey(keyId: string) {
    if (!confirm('Permanently delete this key?')) return
    await fetch('/api/admin/agent-settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'delete_key', key_id: keyId }),
    })
    void load()
  }

  function handleCopy() {
    if (revealedKey) {
      navigator.clipboard.writeText(revealedKey)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  if (loading) {
    return (
      <div className="rounded-lg border border-white/10 bg-white/5 p-4 text-sm text-white/40">
        Loading AI Agent settings...
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Master switch */}
      <div className="space-y-3 rounded-lg border border-white/10 bg-white/5 p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Bot className="h-4 w-4 text-white/70" />
            <span className="text-sm font-medium text-white/70">
              AI Agent Booking API
            </span>
          </div>
          <button
            onClick={() => void handleToggleApi()}
            disabled={toggling}
            className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors disabled:opacity-50 ${
              settings?.ai_agent_api_enabled ? 'bg-green-500' : 'bg-white/20'
            }`}
          >
            <span
              className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${
                settings?.ai_agent_api_enabled
                  ? 'translate-x-4'
                  : 'translate-x-1'
              }`}
            />
          </button>
        </div>
        <p className="text-xs text-white/40">
          {settings?.ai_agent_api_enabled
            ? 'AI agents (ChatGPT, Gemini, Claude, Grok, Perplexity) can view services, check availability, and book jobs.'
            : 'API is off. AI agents cannot access your booking system.'}
        </p>
      </div>

      {/* Promo settings */}
      <div className="space-y-3 rounded-lg border border-white/10 bg-white/5 p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Gift className="h-4 w-4 text-white/70" />
            <span className="text-sm font-medium text-white/70">
              AI Agent Promo
            </span>
          </div>
          <button
            onClick={() => void handleTogglePromo()}
            className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
              settings?.ai_agent_promo_enabled ? 'bg-green-500' : 'bg-white/20'
            }`}
          >
            <span
              className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${
                settings?.ai_agent_promo_enabled
                  ? 'translate-x-4'
                  : 'translate-x-1'
              }`}
            />
          </button>
        </div>
        {settings?.ai_agent_promo_enabled ? (
          <div className="space-y-3">
            <p className="text-xs text-white/40">
              AI agents advertise this discount to customers who book through
              them.
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs text-white/50">Discount ($)</Label>
                <Input
                  type="number"
                  step="1"
                  value={promoDiscount}
                  onChange={(e) => setPromoDiscount(e.target.value)}
                  className="mt-1 h-8 border-white/10 bg-white/5 text-sm text-white"
                />
              </div>
              <div>
                <Label className="text-xs text-white/50">Minimum ($)</Label>
                <Input
                  type="number"
                  step="1"
                  value={promoMinimum}
                  onChange={(e) => setPromoMinimum(e.target.value)}
                  className="mt-1 h-8 border-white/10 bg-white/5 text-sm text-white"
                />
              </div>
            </div>
            <Button
              size="sm"
              variant="outline"
              disabled={savingPromo}
              onClick={() => void handleSavePromo()}
              className="border-white/10 text-xs text-white/70 hover:bg-white/10"
            >
              {savingPromo ? (
                <Loader2 className="mr-1 h-3 w-3 animate-spin" />
              ) : null}
              Save Promo
            </Button>
          </div>
        ) : (
          <p className="text-xs text-white/40">
            Promo is off. AI agents will not advertise any discount.
          </p>
        )}
      </div>

      {/* API Keys */}
      <div className="space-y-3 rounded-lg border border-white/10 bg-white/5 p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Key className="h-4 w-4 text-white/70" />
            <span className="text-sm font-medium text-white/70">API Keys</span>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setShowNewKey(true)}
            className="border-white/10 text-xs text-white/70 hover:bg-white/10"
          >
            <Plus className="mr-1 h-3 w-3" />
            New Key
          </Button>
        </div>

        {/* Revealed key banner */}
        {revealedKey ? (
          <div className="rounded-md border border-yellow-500/30 bg-yellow-500/10 p-3">
            <p className="mb-2 text-xs font-semibold text-yellow-400">
              Save this key now — it will not be shown again
            </p>
            <div className="flex items-center gap-2">
              <code className="flex-1 rounded bg-black/30 px-2 py-1 font-mono text-xs break-all text-yellow-300">
                {revealedKey}
              </code>
              <Button
                size="sm"
                variant="ghost"
                onClick={handleCopy}
                className="shrink-0 text-yellow-400 hover:text-yellow-300"
              >
                <Copy className="h-3.5 w-3.5" />
              </Button>
            </div>
            {copied ? (
              <p className="mt-1 text-xs text-green-400">Copied!</p>
            ) : null}
            <Button
              size="sm"
              variant="ghost"
              className="mt-2 text-xs text-white/40"
              onClick={() => setRevealedKey(null)}
            >
              Dismiss
            </Button>
          </div>
        ) : null}

        {/* New key form */}
        {showNewKey ? (
          <div className="space-y-2 rounded-md border border-white/10 bg-white/5 p-3">
            <div>
              <Label className="text-xs text-white/50">
                Label (e.g. ChatGPT, Gemini, Claude, Grok, Perplexity)
              </Label>
              <Input
                value={newKeyLabel}
                onChange={(e) => setNewKeyLabel(e.target.value)}
                placeholder="ChatGPT"
                className="mt-1 h-8 border-white/10 bg-white/5 text-sm text-white"
              />
            </div>
            <div>
              <Label className="text-xs text-white/50">Booking Mode</Label>
              <div className="mt-1 flex gap-2">
                <button
                  type="button"
                  onClick={() => setNewKeyMode('request')}
                  className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                    newKeyMode === 'request'
                      ? 'bg-blue-500/20 text-blue-400'
                      : 'bg-white/5 text-white/40 hover:bg-white/10'
                  }`}
                >
                  Request (you approve)
                </button>
                <button
                  type="button"
                  onClick={() => setNewKeyMode('direct')}
                  className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                    newKeyMode === 'direct'
                      ? 'bg-green-500/20 text-green-400'
                      : 'bg-white/5 text-white/40 hover:bg-white/10'
                  }`}
                >
                  Direct (auto-confirm)
                </button>
              </div>
            </div>
            <div className="flex gap-2 pt-1">
              <Button
                size="sm"
                disabled={creating}
                onClick={() => void handleCreateKey()}
                className="bg-green-600 text-xs text-white hover:bg-green-700"
              >
                {creating ? (
                  <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                ) : null}
                Generate Key
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setShowNewKey(false)}
                className="text-xs text-white/40"
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : null}

        {/* Key list */}
        {keys.length > 0 ? (
          <div className="space-y-2">
            {keys.map((key) => (
              <div
                key={key.id}
                className="flex items-center justify-between rounded-md border border-white/10 bg-white/5 px-3 py-2"
              >
                <div className="flex items-center gap-3">
                  <div>
                    <span className="text-sm font-medium text-white/80">
                      {key.label}
                    </span>
                    <div className="flex items-center gap-2 text-xs text-white/40">
                      <Badge
                        variant="outline"
                        className={`border-0 px-1.5 py-0 text-[10px] ${
                          key.booking_mode === 'direct'
                            ? 'bg-green-500/20 text-green-400'
                            : 'bg-blue-500/20 text-blue-400'
                        }`}
                      >
                        {key.booking_mode}
                      </Badge>
                      {!key.is_active ? (
                        <Badge
                          variant="outline"
                          className="border-0 bg-red-500/20 px-1.5 py-0 text-[10px] text-red-400"
                        >
                          revoked
                        </Badge>
                      ) : null}
                    </div>
                  </div>
                </div>
                <div className="flex gap-1">
                  {key.is_active ? (
                    <button
                      onClick={() => void handleRevokeKey(key.id)}
                      className="rounded p-1 text-white/30 transition-colors hover:bg-red-500/20 hover:text-red-400"
                      title="Revoke"
                    >
                      <Key className="h-3.5 w-3.5" />
                    </button>
                  ) : (
                    <button
                      onClick={() => void handleDeleteKey(key.id)}
                      className="rounded p-1 text-white/30 transition-colors hover:bg-red-500/20 hover:text-red-400"
                      title="Delete"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-white/30">
            No API keys yet. Create one to give an AI agent access.
          </p>
        )}
      </div>
    </div>
  )
}
