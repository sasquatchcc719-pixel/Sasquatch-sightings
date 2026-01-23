'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import { 
  Phone, 
  Download, 
  Search, 
  Calendar,
  Loader2,
  Trash2,
  MessageSquare,
  User,
  MapPin,
  Mail,
  Building2,
  PhoneMissed,
  Trophy,
  Globe,
  ChevronDown,
  ChevronUp,
  Save
} from 'lucide-react'

type Lead = {
  id: string
  source: 'contest' | 'partner' | 'missed_call' | 'website'
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
  created_at: string
  contacted_at: string | null
  scheduled_at: string | null
  won_at: string | null
}

const SOURCE_ICONS = {
  contest: Trophy,
  partner: Building2,
  missed_call: PhoneMissed,
  website: Globe,
}

const SOURCE_LABELS = {
  contest: 'Contest',
  partner: 'Partner',
  missed_call: 'Missed Call',
  website: 'Website',
}

const STATUS_COLORS: Record<Lead['status'], string> = {
  new: 'bg-blue-500',
  contacted: 'bg-yellow-500',
  quoted: 'bg-purple-500',
  scheduled: 'bg-orange-500',
  won: 'bg-green-600',
  lost: 'bg-red-500',
}

const STATUSES: Lead['status'][] = ['new', 'contacted', 'quoted', 'scheduled', 'won', 'lost']

export default function LeadsAdminPage() {
  const [leads, setLeads] = useState<Lead[]>([])
  const [filteredLeads, setFilteredLeads] = useState<Lead[]>([])
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')
  const [statusFilter, setStatusFilter] = useState<Lead['status'] | 'all'>('all')
  const [sourceFilter, setSourceFilter] = useState<Lead['source'] | 'all'>('all')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [updatingId, setUpdatingId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [editingNotes, setEditingNotes] = useState<Record<string, string>>({})

  // Fetch leads
  useEffect(() => {
    async function fetchLeads() {
      try {
        const response = await fetch('/api/leads')
        const data = await response.json()
        if (data.leads) {
          setLeads(data.leads)
          setFilteredLeads(data.leads)
        }
      } catch (error) {
        console.error('Error fetching leads:', error)
      } finally {
        setLoading(false)
      }
    }

    fetchLeads()
  }, [])

  // Apply filters and search
  useEffect(() => {
    let filtered = leads

    // Apply status filter
    if (statusFilter !== 'all') {
      filtered = filtered.filter(l => l.status === statusFilter)
    }

    // Apply source filter
    if (sourceFilter !== 'all') {
      filtered = filtered.filter(l => l.source === sourceFilter)
    }

    // Apply search
    if (searchTerm) {
      const term = searchTerm.toLowerCase()
      filtered = filtered.filter(l => 
        l.name?.toLowerCase().includes(term) ||
        l.phone.includes(term) ||
        l.email?.toLowerCase().includes(term) ||
        l.location?.toLowerCase().includes(term) ||
        l.notes?.toLowerCase().includes(term)
      )
    }

    setFilteredLeads(filtered)
  }, [leads, statusFilter, sourceFilter, searchTerm])

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
        setLeads(prev =>
          prev.map(l => l.id === id ? { ...l, ...data.lead } : l)
        )
      }
    } catch (error) {
      console.error('Error updating lead status:', error)
    } finally {
      setUpdatingId(null)
    }
  }

  // Handle notes save
  const handleSaveNotes = async (id: string) => {
    const notes = editingNotes[id]
    if (notes === undefined) return

    setUpdatingId(id)
    try {
      const response = await fetch('/api/leads', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, notes }),
      })

      if (response.ok) {
        setLeads(prev =>
          prev.map(l => l.id === id ? { ...l, notes } : l)
        )
        // Clear editing state
        setEditingNotes(prev => {
          const next = { ...prev }
          delete next[id]
          return next
        })
      }
    } catch (error) {
      console.error('Error saving notes:', error)
    } finally {
      setUpdatingId(null)
    }
  }

  // Handle delete
  const handleDelete = async (id: string, name: string | null) => {
    const displayName = name || 'this lead'
    if (!confirm(`Are you sure you want to delete ${displayName}? This cannot be undone.`)) {
      return
    }

    setDeletingId(id)
    try {
      const response = await fetch(`/api/leads?id=${id}`, {
        method: 'DELETE',
      })

      if (response.ok) {
        setLeads(prev => prev.filter(l => l.id !== id))
      } else {
        const data = await response.json()
        alert(`Failed to delete: ${data.error || 'Unknown error'}`)
      }
    } catch (error) {
      console.error('Error deleting lead:', error)
      alert('Failed to delete. Please try again.')
    } finally {
      setDeletingId(null)
    }
  }

  // Export to CSV
  const handleExportCSV = () => {
    const csvContent = [
      ['Source', 'Name', 'Phone', 'Email', 'Location', 'Status', 'Notes', 'Partner', 'Created', 'Contacted', 'Scheduled', 'Won'],
      ...filteredLeads.map(l => [
        SOURCE_LABELS[l.source],
        l.name || '',
        l.phone,
        l.email || '',
        l.location || '',
        l.status,
        l.notes?.replace(/,/g, ';') || '',
        l.partner?.company_name || '',
        new Date(l.created_at).toLocaleDateString(),
        l.contacted_at ? new Date(l.contacted_at).toLocaleDateString() : '',
        l.scheduled_at ? new Date(l.scheduled_at).toLocaleDateString() : '',
        l.won_at ? new Date(l.won_at).toLocaleDateString() : '',
      ])
    ]
      .map(row => row.map(cell => `"${cell}"`).join(','))
      .join('\n')

    const blob = new Blob([csvContent], { type: 'text/csv' })
    const url = window.URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `leads-${new Date().toISOString().split('T')[0]}.csv`
    a.click()
    window.URL.revokeObjectURL(url)
  }

  // Stats
  const stats = {
    total: leads.length,
    new: leads.filter(l => l.status === 'new').length,
    contacted: leads.filter(l => l.status === 'contacted').length,
    quoted: leads.filter(l => l.status === 'quoted').length,
    scheduled: leads.filter(l => l.status === 'scheduled').length,
    won: leads.filter(l => l.status === 'won').length,
    lost: leads.filter(l => l.status === 'lost').length,
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    )
  }

  return (
    <div className="w-full space-y-4 sm:space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold sm:text-3xl">
            <Phone className="h-6 w-6 sm:h-8 sm:w-8" />
            Lead Tracker
          </h1>
          <p className="text-sm text-muted-foreground">
            Track all leads from all sources
          </p>
        </div>
        <Button onClick={handleExportCSV} variant="outline" size="sm">
          <Download className="mr-2 h-4 w-4" />
          Export CSV
        </Button>
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-7 sm:gap-4">
        <Card className="p-3 text-center">
          <p className="text-2xl font-bold">{stats.total}</p>
          <p className="text-xs text-muted-foreground">Total</p>
        </Card>
        <Card className="p-3 text-center border-blue-500/50">
          <p className="text-2xl font-bold text-blue-500">{stats.new}</p>
          <p className="text-xs text-muted-foreground">New</p>
        </Card>
        <Card className="p-3 text-center border-yellow-500/50">
          <p className="text-2xl font-bold text-yellow-500">{stats.contacted}</p>
          <p className="text-xs text-muted-foreground">Contacted</p>
        </Card>
        <Card className="p-3 text-center border-purple-500/50">
          <p className="text-2xl font-bold text-purple-500">{stats.quoted}</p>
          <p className="text-xs text-muted-foreground">Quoted</p>
        </Card>
        <Card className="p-3 text-center border-orange-500/50">
          <p className="text-2xl font-bold text-orange-500">{stats.scheduled}</p>
          <p className="text-xs text-muted-foreground">Scheduled</p>
        </Card>
        <Card className="p-3 text-center border-green-500/50">
          <p className="text-2xl font-bold text-green-600">{stats.won}</p>
          <p className="text-xs text-muted-foreground">Won</p>
        </Card>
        <Card className="p-3 text-center border-red-500/50">
          <p className="text-2xl font-bold text-red-500">{stats.lost}</p>
          <p className="text-xs text-muted-foreground">Lost</p>
        </Card>
      </div>

      {/* Filters */}
      <div className="space-y-3">
        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search by name, phone, email, location..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-9"
          />
        </div>

        {/* Filter Buttons */}
        <div className="flex flex-wrap gap-2">
          {/* Status Filter */}
          <Button
            size="sm"
            variant={statusFilter === 'all' ? 'default' : 'outline'}
            onClick={() => setStatusFilter('all')}
            className="text-xs"
          >
            All Status
          </Button>
          {STATUSES.map(status => (
            <Button
              key={status}
              size="sm"
              variant={statusFilter === status ? 'default' : 'outline'}
              onClick={() => setStatusFilter(status)}
              className="text-xs capitalize"
            >
              {status}
            </Button>
          ))}
        </div>

        <div className="flex flex-wrap gap-2">
          {/* Source Filter */}
          <Button
            size="sm"
            variant={sourceFilter === 'all' ? 'secondary' : 'ghost'}
            onClick={() => setSourceFilter('all')}
            className="text-xs"
          >
            All Sources
          </Button>
          {(['contest', 'partner', 'missed_call', 'website'] as const).map(source => {
            const Icon = SOURCE_ICONS[source]
            return (
              <Button
                key={source}
                size="sm"
                variant={sourceFilter === source ? 'secondary' : 'ghost'}
                onClick={() => setSourceFilter(source)}
                className="text-xs"
              >
                <Icon className="mr-1 h-3 w-3" />
                {SOURCE_LABELS[source]}
              </Button>
            )
          })}
        </div>
      </div>

      {/* Results Count */}
      <p className="text-sm text-muted-foreground">
        Showing {filteredLeads.length} of {leads.length} leads
      </p>

      {/* Leads List */}
      <div className="space-y-3">
        {filteredLeads.length === 0 ? (
          <Card className="p-8 text-center text-muted-foreground">
            No leads found
          </Card>
        ) : (
          filteredLeads.map((lead) => {
            const SourceIcon = SOURCE_ICONS[lead.source]
            const isExpanded = expandedId === lead.id
            const currentNotes = editingNotes[lead.id] ?? lead.notes ?? ''

            return (
              <Card key={lead.id} className="overflow-hidden">
                <div className="p-3 sm:p-4">
                  {/* Main Row */}
                  <div className="flex items-start justify-between gap-3">
                    {/* Left: Source Icon + Info */}
                    <div className="flex items-start gap-3 min-w-0 flex-1">
                      {/* Source Icon */}
                      <div className={`shrink-0 rounded-full p-2 ${
                        lead.source === 'contest' ? 'bg-yellow-500/20 text-yellow-600' :
                        lead.source === 'partner' ? 'bg-blue-500/20 text-blue-600' :
                        lead.source === 'missed_call' ? 'bg-red-500/20 text-red-600' :
                        'bg-green-500/20 text-green-600'
                      }`}>
                        <SourceIcon className="h-5 w-5" />
                      </div>

                      {/* Lead Info */}
                      <div className="min-w-0 flex-1 space-y-1">
                        {/* Name + Status */}
                        <div className="flex flex-wrap items-center gap-2">
                          {lead.name ? (
                            <span className="font-semibold">{lead.name}</span>
                          ) : (
                            <span className="text-muted-foreground italic">Unknown</span>
                          )}
                          <Badge className={`${STATUS_COLORS[lead.status]} text-white text-xs`}>
                            {lead.status}
                          </Badge>
                          {lead.partner && (
                            <Badge variant="outline" className="text-xs">
                              via {lead.partner.company_name}
                            </Badge>
                          )}
                        </div>

                        {/* Phone (clickable) */}
                        <a 
                          href={`tel:${lead.phone}`}
                          className="flex items-center gap-1 text-sm text-green-600 hover:underline dark:text-green-400"
                        >
                          <Phone className="h-3 w-3" />
                          {lead.phone}
                        </a>

                        {/* Additional Info */}
                        <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                          {lead.email && (
                            <a href={`mailto:${lead.email}`} className="flex items-center gap-1 hover:text-foreground">
                              <Mail className="h-3 w-3" />
                              <span className="truncate max-w-[150px]">{lead.email}</span>
                            </a>
                          )}
                          {lead.location && (
                            <span className="flex items-center gap-1">
                              <MapPin className="h-3 w-3" />
                              {lead.location}
                            </span>
                          )}
                          <span className="flex items-center gap-1">
                            <Calendar className="h-3 w-3" />
                            {new Date(lead.created_at).toLocaleDateString('en-US', {
                              month: 'short',
                              day: 'numeric',
                            })}
                          </span>
                        </div>

                        {/* Notes Preview */}
                        {lead.notes && !isExpanded && (
                          <p className="text-xs text-muted-foreground truncate">
                            <MessageSquare className="inline h-3 w-3 mr-1" />
                            {lead.notes}
                          </p>
                        )}
                      </div>
                    </div>

                    {/* Right: Expand Button */}
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setExpandedId(isExpanded ? null : lead.id)}
                    >
                      {isExpanded ? (
                        <ChevronUp className="h-4 w-4" />
                      ) : (
                        <ChevronDown className="h-4 w-4" />
                      )}
                    </Button>
                  </div>

                  {/* Expanded Section */}
                  {isExpanded && (
                    <div className="mt-4 space-y-4 border-t pt-4">
                      {/* Status Buttons */}
                      <div>
                        <p className="text-xs font-medium text-muted-foreground mb-2">Change Status:</p>
                        <div className="flex flex-wrap gap-2">
                          {STATUSES.map(status => (
                            <Button
                              key={status}
                              size="sm"
                              variant={lead.status === status ? 'default' : 'outline'}
                              className={`text-xs capitalize ${lead.status === status ? STATUS_COLORS[status] : ''}`}
                              onClick={() => handleStatusChange(lead.id, status)}
                              disabled={updatingId === lead.id}
                            >
                              {updatingId === lead.id ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                              ) : (
                                status
                              )}
                            </Button>
                          ))}
                        </div>
                      </div>

                      {/* Notes */}
                      <div>
                        <p className="text-xs font-medium text-muted-foreground mb-2">Notes:</p>
                        <Textarea
                          value={currentNotes}
                          onChange={(e) => setEditingNotes(prev => ({ ...prev, [lead.id]: e.target.value }))}
                          placeholder="Add notes about this lead..."
                          className="text-sm"
                          rows={3}
                        />
                        {editingNotes[lead.id] !== undefined && editingNotes[lead.id] !== (lead.notes ?? '') && (
                          <Button
                            size="sm"
                            className="mt-2"
                            onClick={() => handleSaveNotes(lead.id)}
                            disabled={updatingId === lead.id}
                          >
                            {updatingId === lead.id ? (
                              <Loader2 className="mr-2 h-3 w-3 animate-spin" />
                            ) : (
                              <Save className="mr-2 h-3 w-3" />
                            )}
                            Save Notes
                          </Button>
                        )}
                      </div>

                      {/* Timestamps */}
                      <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
                        <span>Created: {new Date(lead.created_at).toLocaleString()}</span>
                        {lead.contacted_at && (
                          <span>Contacted: {new Date(lead.contacted_at).toLocaleString()}</span>
                        )}
                        {lead.scheduled_at && (
                          <span>Scheduled: {new Date(lead.scheduled_at).toLocaleString()}</span>
                        )}
                        {lead.won_at && (
                          <span className="text-green-600">Won: {new Date(lead.won_at).toLocaleString()}</span>
                        )}
                      </div>

                      {/* Delete Button */}
                      <div className="flex justify-end">
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => handleDelete(lead.id, lead.name)}
                          disabled={deletingId === lead.id}
                        >
                          {deletingId === lead.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <>
                              <Trash2 className="mr-2 h-4 w-4" />
                              Delete Lead
                            </>
                          )}
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              </Card>
            )
          })
        )}
      </div>
    </div>
  )
}
