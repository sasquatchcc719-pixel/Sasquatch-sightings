'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import {
  Phone,
  Search,
  Calendar,
  Loader2,
  Trash2,
  MessageSquare,
  MapPin,
  Mail,
  Building2,
  PhoneMissed,
  Trophy,
  Globe,
  X,
  ChevronRight,
  Save,
  Plus,
} from 'lucide-react'
import { Label } from '@/components/ui/label'

type SmsLog = {
  id: string
  message_type: string
  message_content: string
  status: string
  sent_at: string
}

type Lead = {
  id: string
  source: string // Allow any source string
  name: string | null
  phone: string
  email: string | null
  location: string | null
  status: 'new' | 'contacted' | 'quoted' | 'scheduled' | 'won' | 'lost'
  notes: string | null
  partner_id: string | null
  partner: {
    name: string
    company_name: string
  } | null
  sms_logs: SmsLog[]
  created_at: string
  contacted_at: string | null
  scheduled_at: string | null
  won_at: string | null
}

const SOURCE_ICONS: Record<string, typeof Trophy> = {
  contest: Trophy,
  Contest: Trophy,
  partner: Building2,
  'NFC Card': Building2,
  'Business Card': Phone,
  missed_call: PhoneMissed,
  website: Globe,
  inbound: MessageSquare,
  SMS: MessageSquare,
}

const SOURCE_LABELS: Record<string, string> = {
  contest: 'Contest',
  Contest: 'Contest',
  partner: 'Vendor',
  'NFC Card': 'Vendor',
  'Business Card': 'Business Card',
  missed_call: 'Missed Call',
  website: 'Website',
  inbound: 'Inbound',
  SMS: 'SMS',
}

const SOURCE_COLORS: Record<string, string> = {
  contest: 'bg-yellow-500/20 text-yellow-600 dark:text-yellow-400',
  Contest: 'bg-yellow-500/20 text-yellow-600 dark:text-yellow-400',
  partner: 'bg-blue-500/20 text-blue-600 dark:text-blue-400',
  'NFC Card': 'bg-blue-500/20 text-blue-600 dark:text-blue-400',
  'Business Card': 'bg-purple-500/20 text-purple-600 dark:text-purple-400',
  missed_call: 'bg-red-500/20 text-red-600 dark:text-red-400',
  website: 'bg-green-500/20 text-green-600 dark:text-green-400',
  inbound: 'bg-gray-500/20 text-gray-600 dark:text-gray-400',
  SMS: 'bg-gray-500/20 text-gray-600 dark:text-gray-400',
}

const STATUS_CONFIG = {
  new: { label: 'New', color: 'bg-blue-500', textColor: 'text-blue-500' },
  contacted: {
    label: 'Contacted',
    color: 'bg-yellow-500',
    textColor: 'text-yellow-500',
  },
  quoted: {
    label: 'Quoted',
    color: 'bg-purple-500',
    textColor: 'text-purple-500',
  },
  scheduled: {
    label: 'Scheduled',
    color: 'bg-orange-500',
    textColor: 'text-orange-500',
  },
  won: { label: 'Won', color: 'bg-green-600', textColor: 'text-green-600' },
  lost: { label: 'Lost', color: 'bg-red-500', textColor: 'text-red-500' },
}

// Helper functions to safely get source info with fallbacks
const getSourceLabel = (source: string) => SOURCE_LABELS[source] || source
const getSourceColor = (source: string) =>
  SOURCE_COLORS[source] || 'bg-gray-500/20 text-gray-600 dark:text-gray-400'

// Source icon component to avoid creating components during render
function SourceIconDisplay({
  source,
  className,
}: {
  source: string
  className?: string
}) {
  const Icon = SOURCE_ICONS[source] || MessageSquare
  return <Icon className={className} />
}

const STATUSES: Lead['status'][] = [
  'new',
  'contacted',
  'quoted',
  'scheduled',
  'won',
  'lost',
]

export default function LeadsDashboardPage() {
  const [leads, setLeads] = useState<Lead[]>([])
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null)
  const [updatingId, setUpdatingId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [editingNotes, setEditingNotes] = useState('')

  // Add Lead Modal state
  const [showAddModal, setShowAddModal] = useState(false)
  const [addingLead, setAddingLead] = useState(false)
  const [newLead, setNewLead] = useState({
    source: 'missed_call' as Lead['source'],
    name: '',
    phone: '',
    email: '',
    location: '',
    notes: '',
  })

  // Fetch leads
  useEffect(() => {
    async function fetchLeads() {
      try {
        const response = await fetch('/api/leads')
        const data = await response.json()
        if (data.leads) {
          setLeads(data.leads)
        }
      } catch (error) {
        console.error('Error fetching leads:', error)
      } finally {
        setLoading(false)
      }
    }
    fetchLeads()
  }, [])

  // Filter leads by search
  const filteredLeads = leads.filter((l) => {
    if (!searchTerm) return true
    const term = searchTerm.toLowerCase()
    return (
      l.name?.toLowerCase().includes(term) ||
      l.phone.includes(term) ||
      l.email?.toLowerCase().includes(term) ||
      l.location?.toLowerCase().includes(term)
    )
  })

  // Group leads by status
  const leadsByStatus = STATUSES.reduce(
    (acc, status) => {
      acc[status] = filteredLeads.filter((l) => l.status === status)
      return acc
    },
    {} as Record<Lead['status'], Lead[]>,
  )

  // Handle status change
  const handleStatusChange = async (id: string, newStatus: Lead['status']) => {
    setUpdatingId(id)
    try {
      const response = await fetch('/api/leads', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, status: newStatus }),
      })

      if (response.ok) {
        const data = await response.json()
        setLeads((prev) =>
          prev.map((l) => (l.id === id ? { ...l, ...data.lead } : l)),
        )
        if (selectedLead?.id === id) {
          setSelectedLead((prev) => (prev ? { ...prev, ...data.lead } : null))
        }
      }
    } catch (error) {
      console.error('Error updating status:', error)
    } finally {
      setUpdatingId(null)
    }
  }

  // Handle notes save
  const handleSaveNotes = async () => {
    if (!selectedLead) return
    setUpdatingId(selectedLead.id)
    try {
      const response = await fetch('/api/leads', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: selectedLead.id, notes: editingNotes }),
      })

      if (response.ok) {
        setLeads((prev) =>
          prev.map((l) =>
            l.id === selectedLead.id ? { ...l, notes: editingNotes } : l,
          ),
        )
        setSelectedLead((prev) =>
          prev ? { ...prev, notes: editingNotes } : null,
        )
      }
    } catch (error) {
      console.error('Error saving notes:', error)
    } finally {
      setUpdatingId(null)
    }
  }

  // Handle delete
  const handleDelete = async () => {
    if (!selectedLead) return
    if (!confirm(`Delete ${selectedLead.name || 'this lead'}?`)) return

    setDeletingId(selectedLead.id)
    try {
      const response = await fetch(`/api/leads?id=${selectedLead.id}`, {
        method: 'DELETE',
      })
      if (response.ok) {
        setLeads((prev) => prev.filter((l) => l.id !== selectedLead.id))
        setSelectedLead(null)
      }
    } catch (error) {
      console.error('Error deleting:', error)
    } finally {
      setDeletingId(null)
    }
  }

  // Open lead detail
  const openLead = (lead: Lead) => {
    setSelectedLead(lead)
    setEditingNotes(lead.notes || '')
  }

  // Add new lead
  const handleAddLead = async () => {
    if (!newLead.phone.trim()) {
      alert('Phone number is required')
      return
    }

    setAddingLead(true)
    try {
      const response = await fetch('/api/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source: newLead.source,
          name: newLead.name.trim() || null,
          phone: newLead.phone.trim(),
          email: newLead.email.trim() || null,
          location: newLead.location.trim() || null,
          notes: newLead.notes.trim() || null,
        }),
      })

      if (response.ok) {
        const data = await response.json()
        // Add to local state
        setLeads((prev) => [data.lead, ...prev])
        // Reset form
        setNewLead({
          source: 'missed_call',
          name: '',
          phone: '',
          email: '',
          location: '',
          notes: '',
        })
        setShowAddModal(false)
      } else {
        const data = await response.json()
        alert(data.error || 'Failed to add lead')
      }
    } catch (error) {
      console.error('Error adding lead:', error)
      alert('Failed to add lead')
    } finally {
      setAddingLead(false)
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold md:text-2xl">Lead Tracker</h1>
        <div className="flex items-center gap-3">
          <span className="text-muted-foreground hidden text-sm sm:inline">
            {leads.length} total
          </span>
          <Button onClick={() => setShowAddModal(true)} size="sm">
            <Plus className="mr-1 h-4 w-4" />
            Add Lead
          </Button>
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="text-muted-foreground absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
        <Input
          placeholder="Search leads..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="h-12 pl-9 text-base"
        />
      </div>

      {/* Stats Row - Mobile only (desktop uses Kanban headers) */}
      <div className="mb-4 grid grid-cols-3 gap-2 md:hidden">
        {STATUSES.map((status) => (
          <div
            key={status}
            className={`rounded-lg px-3 py-2 text-center ${STATUS_CONFIG[status].color} text-white`}
          >
            <div className="text-lg font-bold">
              {leadsByStatus[status].length}
            </div>
            <div className="text-xs opacity-90">
              {STATUS_CONFIG[status].label}
            </div>
          </div>
        ))}
      </div>

      {/* MOBILE VIEW: Vertical scroll by status */}
      <div className="space-y-6 md:hidden">
        {STATUSES.map((status) => {
          const statusLeads = leadsByStatus[status]
          if (statusLeads.length === 0) return null

          return (
            <div key={status}>
              {/* Status Header */}
              <div className="mb-3 flex items-center gap-2">
                <div
                  className={`h-3 w-3 rounded-full ${STATUS_CONFIG[status].color}`}
                />
                <h2 className="font-semibold">{STATUS_CONFIG[status].label}</h2>
                <Badge variant="secondary" className="text-xs">
                  {statusLeads.length}
                </Badge>
              </div>

              {/* Lead Cards */}
              <div className="space-y-2">
                {statusLeads.map((lead) => (
                  <LeadCard
                    key={lead.id}
                    lead={lead}
                    onClick={() => openLead(lead)}
                  />
                ))}
              </div>
            </div>
          )
        })}
      </div>

      {/* DESKTOP VIEW: Kanban Columns */}
      <div className="hidden md:grid md:grid-cols-6 md:gap-4">
        {STATUSES.map((status) => (
          <div key={status} className="space-y-2">
            {/* Column Header */}
            <div
              className={`rounded-lg p-3 text-center ${STATUS_CONFIG[status].color} text-white`}
            >
              <div className="font-semibold">{STATUS_CONFIG[status].label}</div>
              <div className="text-2xl font-bold">
                {leadsByStatus[status].length}
              </div>
            </div>

            {/* Column Cards */}
            <div className="max-h-[60vh] space-y-2 overflow-y-auto">
              {leadsByStatus[status].map((lead) => (
                <LeadCardCompact
                  key={lead.id}
                  lead={lead}
                  onClick={() => openLead(lead)}
                />
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* MOBILE: Full Screen Detail View */}
      {selectedLead && (
        <div className="bg-background fixed inset-0 z-50 overflow-y-auto md:hidden">
          <div className="bg-background sticky top-0 z-10 flex items-center justify-between border-b p-4">
            <button
              onClick={() => setSelectedLead(null)}
              className="text-muted-foreground flex items-center gap-1"
            >
              <X className="h-5 w-5" />
              Close
            </button>
            <Badge
              className={`${STATUS_CONFIG[selectedLead.status].color} text-white`}
            >
              {STATUS_CONFIG[selectedLead.status].label}
            </Badge>
          </div>

          <div className="space-y-6 p-4">
            {/* Lead Info */}
            <div className="space-y-4">
              {/* Source Badge */}
              <div
                className={`inline-flex items-center gap-2 rounded-full px-3 py-1 ${getSourceColor(selectedLead.source)}`}
              >
                <SourceIconDisplay
                  source={selectedLead.source}
                  className="h-4 w-4"
                />
                <span className="text-sm font-medium">
                  {getSourceLabel(selectedLead.source)}
                </span>
              </div>

              {/* Name */}
              <h2 className="text-2xl font-bold">
                {selectedLead.name || (
                  <span className="text-muted-foreground italic">Unknown</span>
                )}
              </h2>

              {/* Phone - Big Tap Target */}
              <a
                href={`tel:${selectedLead.phone}`}
                className="flex items-center gap-3 rounded-xl bg-green-600 p-4 text-white active:bg-green-700"
              >
                <Phone className="h-6 w-6" />
                <span className="text-xl font-semibold">
                  {selectedLead.phone}
                </span>
              </a>

              {/* Email */}
              {selectedLead.email && (
                <a
                  href={`mailto:${selectedLead.email}`}
                  className="active:bg-muted flex items-center gap-3 rounded-xl border p-4"
                >
                  <Mail className="text-muted-foreground h-5 w-5" />
                  <span>{selectedLead.email}</span>
                </a>
              )}

              {/* Location */}
              {selectedLead.location && (
                <div className="flex items-center gap-3 rounded-xl border p-4">
                  <MapPin className="text-muted-foreground h-5 w-5" />
                  <span>{selectedLead.location}</span>
                </div>
              )}

              {/* Partner */}
              {selectedLead.partner && (
                <div className="flex items-center gap-3 rounded-xl border p-4">
                  <Building2 className="text-muted-foreground h-5 w-5" />
                  <span>via {selectedLead.partner.company_name}</span>
                </div>
              )}

              {/* Date */}
              <div className="text-muted-foreground flex items-center gap-3">
                <Calendar className="h-4 w-4" />
                <span className="text-sm">
                  {new Date(selectedLead.created_at).toLocaleDateString(
                    'en-US',
                    {
                      weekday: 'short',
                      month: 'short',
                      day: 'numeric',
                      hour: 'numeric',
                      minute: '2-digit',
                    },
                  )}
                </span>
              </div>
            </div>

            {/* Status Buttons */}
            <div className="space-y-2">
              <h3 className="text-muted-foreground text-sm font-medium">
                Change Status
              </h3>
              <div className="grid grid-cols-3 gap-2">
                {STATUSES.map((status) => (
                  <button
                    key={status}
                    onClick={() => handleStatusChange(selectedLead.id, status)}
                    disabled={updatingId === selectedLead.id}
                    className={`min-h-[56px] rounded-xl p-4 text-center font-medium transition-all ${
                      selectedLead.status === status
                        ? `${STATUS_CONFIG[status].color} text-white`
                        : 'border-muted hover:border-foreground/20 border-2'
                    } `}
                  >
                    {updatingId === selectedLead.id ? (
                      <Loader2 className="mx-auto h-5 w-5 animate-spin" />
                    ) : (
                      STATUS_CONFIG[status].label
                    )}
                  </button>
                ))}
              </div>
            </div>

            {/* Notes */}
            <div className="space-y-2">
              <h3 className="text-muted-foreground flex items-center gap-2 text-sm font-medium">
                <MessageSquare className="h-4 w-4" />
                Notes
              </h3>
              <Textarea
                value={editingNotes}
                onChange={(e) => setEditingNotes(e.target.value)}
                placeholder="Add notes about this lead..."
                className="min-h-[120px] text-base"
                rows={5}
              />
              {editingNotes !== (selectedLead.notes || '') && (
                <Button
                  onClick={handleSaveNotes}
                  disabled={updatingId === selectedLead.id}
                  className="h-12 w-full"
                >
                  {updatingId === selectedLead.id ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Save className="mr-2 h-4 w-4" />
                  )}
                  Save Notes
                </Button>
              )}
            </div>

            {/* SMS History */}
            {selectedLead.sms_logs && selectedLead.sms_logs.length > 0 && (
              <div className="space-y-2">
                <h3 className="text-muted-foreground flex items-center gap-2 text-sm font-medium">
                  <MessageSquare className="h-4 w-4" />
                  SMS History ({selectedLead.sms_logs.length})
                </h3>
                <div className="space-y-2">
                  {selectedLead.sms_logs.map((sms) => (
                    <div
                      key={sms.id}
                      className="space-y-2 rounded-lg border p-3"
                    >
                      <div className="flex items-center justify-between">
                        <Badge
                          variant={
                            sms.status === 'sent' ? 'default' : 'destructive'
                          }
                          className="text-xs"
                        >
                          {sms.message_type.replace(/_/g, ' ')}
                        </Badge>
                        <span className="text-muted-foreground text-xs">
                          {new Date(sms.sent_at).toLocaleDateString('en-US', {
                            month: 'short',
                            day: 'numeric',
                            hour: 'numeric',
                            minute: '2-digit',
                          })}
                        </span>
                      </div>
                      <p className="text-sm whitespace-pre-wrap">
                        {sms.message_content}
                      </p>
                      {sms.status !== 'sent' && (
                        <Badge variant="destructive" className="text-xs">
                          Failed
                        </Badge>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Delete */}
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={deletingId === selectedLead.id}
              className="h-12 w-full"
            >
              {deletingId === selectedLead.id ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="mr-2 h-4 w-4" />
              )}
              Delete Lead
            </Button>
          </div>
        </div>
      )}

      {/* DESKTOP: Modal Detail View */}
      {selectedLead && (
        <div
          className="fixed inset-0 z-50 hidden items-center justify-center bg-black/50 md:flex"
          onClick={() => setSelectedLead(null)}
        >
          <div
            className="bg-background m-4 max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="bg-background sticky top-0 flex items-center justify-between rounded-t-xl border-b p-4">
              <div className="flex items-center gap-3">
                <div
                  className={`rounded-full p-2 ${getSourceColor(selectedLead.source)}`}
                >
                  <SourceIconDisplay
                    source={selectedLead.source}
                    className="h-4 w-4"
                  />
                </div>
                <div>
                  <h2 className="font-semibold">
                    {selectedLead.name || 'Unknown'}
                  </h2>
                  <p className="text-muted-foreground text-sm">
                    {selectedLead.phone}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setSelectedLead(null)}
                className="hover:bg-muted rounded-lg p-2"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-4 p-4">
              {/* Quick Actions */}
              <div className="flex gap-2">
                <a
                  href={`tel:${selectedLead.phone}`}
                  className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-green-600 p-3 text-white hover:bg-green-700"
                >
                  <Phone className="h-4 w-4" />
                  Call
                </a>
                {selectedLead.email && (
                  <a
                    href={`mailto:${selectedLead.email}`}
                    className="hover:bg-muted flex flex-1 items-center justify-center gap-2 rounded-lg border p-3"
                  >
                    <Mail className="h-4 w-4" />
                    Email
                  </a>
                )}
              </div>

              {/* Info */}
              <div className="space-y-2 text-sm">
                {selectedLead.location && (
                  <div className="text-muted-foreground flex items-center gap-2">
                    <MapPin className="h-4 w-4" />
                    {selectedLead.location}
                  </div>
                )}
                {selectedLead.partner && (
                  <div className="text-muted-foreground flex items-center gap-2">
                    <Building2 className="h-4 w-4" />
                    via {selectedLead.partner.company_name}
                  </div>
                )}
                <div className="text-muted-foreground flex items-center gap-2">
                  <Calendar className="h-4 w-4" />
                  {new Date(selectedLead.created_at).toLocaleString()}
                </div>
              </div>

              {/* Status */}
              <div>
                <p className="text-muted-foreground mb-2 text-xs font-medium">
                  Status
                </p>
                <div className="flex flex-wrap gap-2">
                  {STATUSES.map((status) => (
                    <button
                      key={status}
                      onClick={() =>
                        handleStatusChange(selectedLead.id, status)
                      }
                      disabled={updatingId === selectedLead.id}
                      className={`rounded-lg px-3 py-2 text-sm font-medium transition-all ${
                        selectedLead.status === status
                          ? `${STATUS_CONFIG[status].color} text-white`
                          : 'hover:bg-muted border'
                      } `}
                    >
                      {STATUS_CONFIG[status].label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Notes */}
              <div>
                <p className="text-muted-foreground mb-2 text-xs font-medium">
                  Notes
                </p>
                <Textarea
                  value={editingNotes}
                  onChange={(e) => setEditingNotes(e.target.value)}
                  placeholder="Add notes..."
                  rows={3}
                />
                {editingNotes !== (selectedLead.notes || '') && (
                  <Button
                    size="sm"
                    className="mt-2"
                    onClick={handleSaveNotes}
                    disabled={updatingId === selectedLead.id}
                  >
                    <Save className="mr-2 h-3 w-3" />
                    Save
                  </Button>
                )}
              </div>

              {/* SMS History */}
              {selectedLead.sms_logs && selectedLead.sms_logs.length > 0 && (
                <div>
                  <p className="text-muted-foreground mb-2 text-xs font-medium">
                    SMS History ({selectedLead.sms_logs.length})
                  </p>
                  <div className="max-h-64 space-y-2 overflow-y-auto">
                    {selectedLead.sms_logs.map((sms) => (
                      <div
                        key={sms.id}
                        className="space-y-1 rounded-lg border p-2 text-xs"
                      >
                        <div className="flex items-center justify-between">
                          <Badge
                            variant={
                              sms.status === 'sent' ? 'default' : 'destructive'
                            }
                            className="text-xs"
                          >
                            {sms.message_type.replace(/_/g, ' ')}
                          </Badge>
                          <span className="text-muted-foreground text-xs">
                            {new Date(sms.sent_at).toLocaleDateString('en-US', {
                              month: 'short',
                              day: 'numeric',
                              hour: 'numeric',
                              minute: '2-digit',
                            })}
                          </span>
                        </div>
                        <p className="text-muted-foreground text-xs whitespace-pre-wrap">
                          {sms.message_content}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Delete */}
              <Button
                variant="ghost"
                size="sm"
                className="text-destructive hover:text-destructive"
                onClick={handleDelete}
                disabled={deletingId === selectedLead.id}
              >
                <Trash2 className="mr-2 h-4 w-4" />
                Delete Lead
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ADD LEAD MODAL */}
      {showAddModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setShowAddModal(false)}
        >
          <div
            className="bg-background max-h-[90vh] w-full max-w-md overflow-y-auto rounded-xl shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="bg-background sticky top-0 flex items-center justify-between rounded-t-xl border-b p-4">
              <h2 className="text-lg font-semibold">Add New Lead</h2>
              <button
                onClick={() => setShowAddModal(false)}
                className="hover:bg-muted rounded-lg p-2"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-4 p-4">
              {/* Source */}
              <div className="space-y-2">
                <Label>Source</Label>
                <div className="grid grid-cols-2 gap-2">
                  {(
                    ['missed_call', 'website', 'contest', 'partner'] as const
                  ).map((source) => {
                    const Icon = SOURCE_ICONS[source]
                    return (
                      <button
                        key={source}
                        type="button"
                        onClick={() =>
                          setNewLead((prev) => ({ ...prev, source }))
                        }
                        className={`flex items-center gap-2 rounded-lg border p-3 text-sm font-medium transition-all ${
                          newLead.source === source
                            ? 'border-primary bg-primary/10 text-primary'
                            : 'hover:bg-muted'
                        } `}
                      >
                        <Icon className="h-4 w-4" />
                        {SOURCE_LABELS[source]}
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* Phone (required) */}
              <div className="space-y-2">
                <Label htmlFor="add-phone">Phone Number *</Label>
                <Input
                  id="add-phone"
                  type="tel"
                  placeholder="(719) 555-1234"
                  value={newLead.phone}
                  onChange={(e) =>
                    setNewLead((prev) => ({ ...prev, phone: e.target.value }))
                  }
                  className="h-12"
                />
              </div>

              {/* Name */}
              <div className="space-y-2">
                <Label htmlFor="add-name">Name</Label>
                <Input
                  id="add-name"
                  placeholder="John Smith"
                  value={newLead.name}
                  onChange={(e) =>
                    setNewLead((prev) => ({ ...prev, name: e.target.value }))
                  }
                />
              </div>

              {/* Email */}
              <div className="space-y-2">
                <Label htmlFor="add-email">Email</Label>
                <Input
                  id="add-email"
                  type="email"
                  placeholder="john@example.com"
                  value={newLead.email}
                  onChange={(e) =>
                    setNewLead((prev) => ({ ...prev, email: e.target.value }))
                  }
                />
              </div>

              {/* Location */}
              <div className="space-y-2">
                <Label htmlFor="add-location">Location</Label>
                <Input
                  id="add-location"
                  placeholder="Colorado Springs, CO"
                  value={newLead.location}
                  onChange={(e) =>
                    setNewLead((prev) => ({
                      ...prev,
                      location: e.target.value,
                    }))
                  }
                />
              </div>

              {/* Notes */}
              <div className="space-y-2">
                <Label htmlFor="add-notes">Notes</Label>
                <Textarea
                  id="add-notes"
                  placeholder="Add any notes..."
                  value={newLead.notes}
                  onChange={(e) =>
                    setNewLead((prev) => ({ ...prev, notes: e.target.value }))
                  }
                  rows={3}
                />
              </div>

              {/* Submit Button */}
              <Button
                onClick={handleAddLead}
                disabled={addingLead || !newLead.phone.trim()}
                className="h-12 w-full"
              >
                {addingLead ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Plus className="mr-2 h-4 w-4" />
                )}
                Add Lead
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// Mobile Lead Card - Large tap targets
function LeadCard({ lead, onClick }: { lead: Lead; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="active:bg-muted w-full rounded-xl border p-4 text-left transition-colors"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          {/* Source Icon */}
          <div
            className={`shrink-0 rounded-full p-2 ${getSourceColor(lead.source)}`}
          >
            <SourceIconDisplay source={lead.source} className="h-5 w-5" />
          </div>

          {/* Info */}
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="truncate font-semibold">
                {lead.name || (
                  <span className="text-muted-foreground italic">Unknown</span>
                )}
              </span>
              <span
                className={`rounded-full px-2 py-0.5 text-xs ${getSourceColor(lead.source)}`}
              >
                {getSourceLabel(lead.source)}
              </span>
            </div>
            <div className="text-sm text-green-600 dark:text-green-400">
              {lead.phone}
            </div>
            {lead.location && (
              <div className="text-muted-foreground mt-1 truncate text-xs">
                {lead.location}
              </div>
            )}
            {lead.notes && (
              <div className="text-muted-foreground mt-1 flex items-center gap-1 truncate text-xs">
                <MessageSquare className="h-3 w-3 shrink-0" />
                {lead.notes}
              </div>
            )}
          </div>
        </div>

        <ChevronRight className="text-muted-foreground h-5 w-5 shrink-0" />
      </div>
    </button>
  )
}

// Desktop Compact Card
function LeadCardCompact({
  lead,
  onClick,
}: {
  lead: Lead
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className="hover:bg-muted w-full rounded-lg border p-3 text-left transition-colors"
    >
      <div className="mb-1 flex items-center gap-2">
        <SourceIconDisplay
          source={lead.source}
          className={`h-3 w-3 ${getSourceColor(lead.source).split(' ')[1]}`}
        />
        <span className="truncate text-sm font-medium">
          {lead.name || 'Unknown'}
        </span>
      </div>
      <div className="text-muted-foreground text-xs">{lead.phone}</div>
      <div
        className={`mt-1 inline-block rounded px-1.5 py-0.5 text-xs ${getSourceColor(lead.source)}`}
      >
        {getSourceLabel(lead.source)}
      </div>
      {lead.notes && (
        <div className="text-muted-foreground mt-1 truncate text-xs">
          {lead.notes}
        </div>
      )}
    </button>
  )
}
