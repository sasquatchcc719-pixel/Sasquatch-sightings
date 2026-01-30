'use client'

import { useEffect, useState } from 'react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import {
  Plus,
  Copy,
  MapPin,
  X,
  ExternalLink,
  MessageSquare,
  Trash2,
} from 'lucide-react'
import { createClient } from '@/supabase/client'

interface LocationPartner {
  id: string
  company_name: string
  location_name: string | null
  location_address: string | null
  location_type: string | null
  card_id: string | null
  phone: string | null
  credit_balance: number
  total_taps: number
  total_conversions: number
  google_review_url: string | null
  coupon_code: string | null
  last_sasquatch_tap_at: string | null
  last_review_tap_at: string | null
  created_at: string
}

// Helper to calculate station status
function getStationStatus(
  lastTap: string | null,
  totalTaps: number,
): 'active' | 'warning' | 'inactive' | 'never' {
  if (!lastTap || totalTaps === 0) return 'never'

  const daysSinceLastTap = Math.floor(
    (Date.now() - new Date(lastTap).getTime()) / (1000 * 60 * 60 * 24),
  )

  if (daysSinceLastTap <= 7) return 'active'
  if (daysSinceLastTap <= 14) return 'warning'
  return 'inactive'
}

// Status badge component
function StatusBadge({ status, label }: { status: string; label: string }) {
  const statusConfig: Record<string, { icon: string; className: string }> = {
    active: {
      icon: '🟢',
      className:
        'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
    },
    warning: {
      icon: '🟡',
      className:
        'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
    },
    inactive: {
      icon: '🔴',
      className: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
    },
    never: {
      icon: '⚪',
      className:
        'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
    },
    not_configured: {
      icon: '➖',
      className:
        'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400',
    },
  }

  const config = statusConfig[status] || statusConfig.never

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${config.className}`}
    >
      {config.icon} {label}
    </span>
  )
}

interface NFCLead {
  id: string
  phone: string | null
  name: string | null
  source: string | null
  notes: string | null
  status: string
  created_at: string
}

export default function LocationPartnersPage() {
  const [partners, setPartners] = useState<LocationPartner[]>([])
  const [nfcLeads, setNfcLeads] = useState<NFCLead[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [newPartner, setNewPartner] = useState({
    company_name: '',
    location_name: '',
    location_address: '',
    location_type: '',
    phone: '',
    card_id: '',
    google_review_url: '',
  })
  const [copiedReviewId, setCopiedReviewId] = useState<string | null>(null)

  useEffect(() => {
    const fetchData = async () => {
      // Fetch partners via API (bypasses RLS)
      try {
        const partnersResponse = await fetch('/api/admin/location-partners')
        const partnersJson = await partnersResponse.json()
        if (partnersJson.partners) {
          setPartners(partnersJson.partners)
        }
      } catch (error) {
        console.error('Failed to load vendors:', error)
      }

      // Fetch NFC leads
      const supabase = createClient()
      const { data: leadsData, error: leadsError } = await supabase
        .from('leads')
        .select('id, phone, name, source, notes, status, created_at')
        .eq('source', 'NFC Card')
        .order('created_at', { ascending: false })
        .limit(20)

      if (leadsError) {
        console.error('Failed to load NFC leads:', leadsError)
      } else {
        setNfcLeads(leadsData || [])
      }

      setIsLoading(false)
    }

    void fetchData()
  }, [])

  const loadData = async () => {
    try {
      const response = await fetch('/api/admin/location-partners')
      const data = await response.json()
      if (data.partners) {
        setPartners(data.partners)
      }
    } catch (error) {
      console.error('Failed to reload vendors:', error)
    }
  }

  const handleCreatePartner = async (e: React.FormEvent) => {
    e.preventDefault()

    try {
      const response = await fetch('/api/admin/location-partners', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newPartner),
      })

      if (!response.ok) {
        const errorData = await response.json()
        alert('Failed to create location partner: ' + errorData.error)
        return
      }

      setNewPartner({
        company_name: '',
        location_name: '',
        location_address: '',
        location_type: '',
        phone: '',
        card_id: '',
        google_review_url: '',
      })
      setIsDialogOpen(false)
      void loadData()
    } catch (error) {
      console.error('Failed to create location partner:', error)
      alert('Failed to create location partner')
    }
  }

  const copyUrl = (partnerId: string) => {
    const url = `${window.location.origin}/tap?partner=${partnerId}`
    void navigator.clipboard.writeText(url)
    setCopiedId(partnerId)
    setTimeout(() => setCopiedId(null), 2000)
  }

  const copyReviewUrl = (partnerId: string) => {
    const url = `${window.location.origin}/review/${partnerId}`
    void navigator.clipboard.writeText(url)
    setCopiedReviewId(partnerId)
    setTimeout(() => setCopiedReviewId(null), 2000)
  }

  const deleteVendor = async (partnerId: string, partnerName: string) => {
    if (
      !confirm(
        `Are you sure you want to delete "${partnerName}"? This cannot be undone.`,
      )
    ) {
      return
    }

    try {
      const response = await fetch(
        `/api/admin/location-partners?id=${partnerId}`,
        {
          method: 'DELETE',
        },
      )

      if (!response.ok) {
        const data = await response.json()
        alert('Failed to delete vendor: ' + data.error)
        return
      }

      void loadData()
    } catch (error) {
      console.error('Failed to delete vendor:', error)
      alert('Failed to delete vendor')
    }
  }

  const conversionRate = (taps: number, conversions: number) => {
    if (taps === 0) return '0%'
    return `${((conversions / taps) * 100).toFixed(1)}%`
  }

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    })
  }

  if (isLoading) {
    return (
      <div className="p-8">
        <p className="text-gray-500">Loading vendors...</p>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 p-4 sm:p-8 dark:bg-gray-900">
      <div className="mx-auto max-w-7xl">
        {/* Header */}
        <div className="mb-6 flex flex-col gap-4 sm:mb-8 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold sm:text-3xl">Vendors</h1>
            <p className="mt-1 text-sm text-gray-600 sm:mt-2 sm:text-base dark:text-gray-400">
              Manage NFC cards at local establishments
            </p>
          </div>
          <Button
            size="lg"
            className="w-full bg-green-600 hover:bg-green-700 sm:w-auto"
            onClick={() => setIsDialogOpen(true)}
          >
            <Plus className="mr-2 h-5 w-5" />
            Add Vendor
          </Button>
        </div>

        {/* NFC Leads from AI Chat */}
        {nfcLeads.length > 0 && (
          <Card className="mb-8 border-2 border-blue-400 bg-blue-50 p-6 dark:border-blue-600 dark:bg-blue-900/20">
            <div className="mb-4 flex items-center gap-2">
              <MessageSquare className="h-5 w-5 text-blue-600" />
              <h2 className="text-xl font-bold text-blue-800 dark:text-blue-200">
                NFC Card Leads ({nfcLeads.length})
              </h2>
            </div>
            <p className="mb-4 text-sm text-blue-700 dark:text-blue-300">
              These leads came from vendor NFC card scans and started an AI
              chat. Match them to HouseCall Pro bookings to track conversions.
            </p>
            <div className="space-y-3">
              {nfcLeads.map((lead) => (
                <div
                  key={lead.id}
                  className="rounded-lg bg-white p-4 shadow-sm dark:bg-gray-800"
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="font-semibold">
                        {lead.name || 'Unknown Name'}
                      </div>
                      <div className="text-sm text-gray-600 dark:text-gray-400">
                        {lead.phone && (
                          <a
                            href={`tel:${lead.phone}`}
                            className="text-blue-600 hover:underline"
                          >
                            {lead.phone}
                          </a>
                        )}
                      </div>
                      {lead.notes && (
                        <div className="mt-1 text-xs text-gray-500 italic dark:text-gray-400">
                          {lead.notes.length > 100
                            ? lead.notes.substring(0, 100) + '...'
                            : lead.notes}
                        </div>
                      )}
                    </div>
                    <div className="text-right">
                      <Badge
                        variant="outline"
                        className={
                          lead.status === 'new'
                            ? 'border-green-500 text-green-600'
                            : lead.status === 'contacted'
                              ? 'border-blue-500 text-blue-600'
                              : 'border-gray-500 text-gray-600'
                        }
                      >
                        {lead.status}
                      </Badge>
                      <div className="mt-1 text-xs text-gray-500">
                        {new Date(lead.created_at).toLocaleDateString('en-US', {
                          month: 'short',
                          day: 'numeric',
                          hour: 'numeric',
                          minute: '2-digit',
                        })}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        )}

        {/* Create Partner Modal */}
        {isDialogOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
            <Card className="max-h-[90vh] w-full max-w-2xl overflow-y-auto p-6">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-2xl font-bold">Create Vendor</h2>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setIsDialogOpen(false)}
                >
                  <X className="h-5 w-5" />
                </Button>
              </div>
              <form onSubmit={handleCreatePartner} className="space-y-4">
                <div>
                  <Label htmlFor="company_name">Business Name *</Label>
                  <Input
                    id="company_name"
                    value={newPartner.company_name}
                    onChange={(e) =>
                      setNewPartner({
                        ...newPartner,
                        company_name: e.target.value,
                      })
                    }
                    placeholder="Joe's Barbershop"
                    required
                  />
                </div>

                <div>
                  <Label htmlFor="location_name">Display Name (Optional)</Label>
                  <Input
                    id="location_name"
                    value={newPartner.location_name}
                    onChange={(e) =>
                      setNewPartner({
                        ...newPartner,
                        location_name: e.target.value,
                      })
                    }
                    placeholder="Joe's Barbershop - Monument"
                  />
                  <p className="mt-1 text-xs text-gray-500">
                    Shown on landing page when customers tap the card
                  </p>
                </div>

                <div>
                  <Label htmlFor="location_address">Address</Label>
                  <Input
                    id="location_address"
                    value={newPartner.location_address}
                    onChange={(e) =>
                      setNewPartner({
                        ...newPartner,
                        location_address: e.target.value,
                      })
                    }
                    placeholder="123 Main St, Monument, CO 80132"
                  />
                </div>

                <div>
                  <Label htmlFor="location_type">Location Type</Label>
                  <Input
                    id="location_type"
                    value={newPartner.location_type}
                    onChange={(e) =>
                      setNewPartner({
                        ...newPartner,
                        location_type: e.target.value,
                      })
                    }
                    placeholder="barbershop, bar, gym, coffee_shop, etc."
                  />
                </div>

                <div>
                  <Label htmlFor="phone">Phone Number *</Label>
                  <Input
                    id="phone"
                    type="tel"
                    value={newPartner.phone}
                    onChange={(e) =>
                      setNewPartner({ ...newPartner, phone: e.target.value })
                    }
                    placeholder="719-555-0123"
                    required
                  />
                  <p className="mt-1 text-xs text-gray-500">
                    Contact number for this location
                  </p>
                </div>

                <div>
                  <Label htmlFor="card_id">Card ID (Optional)</Label>
                  <Input
                    id="card_id"
                    value={newPartner.card_id}
                    onChange={(e) =>
                      setNewPartner({ ...newPartner, card_id: e.target.value })
                    }
                    placeholder="barbershop-001"
                  />
                  <p className="mt-1 text-xs text-gray-500">
                    Physical card identifier for tracking
                  </p>
                </div>

                <div>
                  <Label htmlFor="google_review_url">
                    Google Review URL (Optional)
                  </Label>
                  <Input
                    id="google_review_url"
                    type="url"
                    value={newPartner.google_review_url}
                    onChange={(e) =>
                      setNewPartner({
                        ...newPartner,
                        google_review_url: e.target.value,
                      })
                    }
                    placeholder="https://g.page/r/..."
                  />
                  <p className="mt-1 text-xs text-gray-500">
                    Their Google review link for the review station we give them
                  </p>
                </div>

                <Button type="submit" className="w-full">
                  Create Vendor
                </Button>
              </form>
            </Card>
          </div>
        )}

        {/* Stats Overview */}
        <div className="mb-6 grid grid-cols-2 gap-3 sm:mb-8 sm:gap-4 md:grid-cols-4">
          <Card className="p-4 sm:p-6">
            <div className="text-xl font-bold sm:text-2xl">
              {partners.length}
            </div>
            <div className="text-xs text-gray-600 sm:text-sm dark:text-gray-400">
              Active Locations
            </div>
          </Card>
          <Card className="p-4 sm:p-6">
            <div className="text-xl font-bold sm:text-2xl">
              {partners.reduce((sum, p) => sum + (p.total_taps || 0), 0)}
            </div>
            <div className="text-xs text-gray-600 sm:text-sm dark:text-gray-400">
              Total Taps
            </div>
          </Card>
          <Card className="p-4 sm:p-6">
            <div className="text-xl font-bold sm:text-2xl">
              {partners.reduce((sum, p) => sum + (p.total_conversions || 0), 0)}
            </div>
            <div className="text-xs text-gray-600 sm:text-sm dark:text-gray-400">
              Bookings
            </div>
          </Card>
          <Card className="p-4 sm:p-6">
            <div className="text-xl font-bold text-green-600 sm:text-2xl">
              {partners.length > 0
                ? (
                    (partners.reduce(
                      (sum, p) => sum + (p.total_conversions || 0),
                      0,
                    ) /
                      Math.max(
                        partners.reduce(
                          (sum, p) => sum + (p.total_taps || 0),
                          0,
                        ),
                        1,
                      )) *
                    100
                  ).toFixed(1)
                : 0}
              %
            </div>
            <div className="text-xs text-gray-600 sm:text-sm dark:text-gray-400">
              Conv. Rate
            </div>
          </Card>
        </div>

        {/* Partners List */}
        {partners.length === 0 ? (
          <Card className="p-12 text-center">
            <MapPin className="mx-auto mb-4 h-12 w-12 text-gray-400" />
            <h3 className="mb-2 text-lg font-semibold">No vendors yet</h3>
            <p className="mb-4 text-sm text-gray-600 dark:text-gray-400">
              Add your first vendor to start tracking NFC card taps
            </p>
          </Card>
        ) : (
          <div className="space-y-4">
            {partners.map((partner) => (
              <Card key={partner.id} className="p-4 sm:p-6">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="flex-1">
                    <h3 className="text-lg font-bold sm:text-xl">
                      {partner.location_name || partner.company_name}
                    </h3>
                    {partner.location_address && (
                      <p className="mt-1 text-xs text-gray-600 sm:text-sm dark:text-gray-400">
                        <MapPin className="mr-1 inline h-3 w-3 sm:h-4 sm:w-4" />
                        {partner.location_address}
                      </p>
                    )}
                    {partner.location_type && (
                      <p className="mt-1 text-xs tracking-wide text-gray-500 uppercase">
                        {partner.location_type}
                      </p>
                    )}
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <a
                      href={`/tap?partner=${partner.id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <Button variant="outline" size="sm">
                        <ExternalLink className="mr-1 h-4 w-4" />
                        View
                      </Button>
                    </a>
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-red-600 hover:bg-red-50 hover:text-red-700"
                      onClick={() =>
                        deleteVendor(
                          partner.id,
                          partner.location_name || partner.company_name,
                        )
                      }
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>

                {/* Station Health Status */}
                <div className="mt-4 flex flex-wrap gap-2">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs text-gray-500">Sasquatch:</span>
                    <StatusBadge
                      status={getStationStatus(
                        partner.last_sasquatch_tap_at,
                        partner.total_taps,
                      )}
                      label={
                        getStationStatus(
                          partner.last_sasquatch_tap_at,
                          partner.total_taps,
                        ) === 'active'
                          ? 'Active'
                          : getStationStatus(
                                partner.last_sasquatch_tap_at,
                                partner.total_taps,
                              ) === 'warning'
                            ? 'Check In'
                            : getStationStatus(
                                  partner.last_sasquatch_tap_at,
                                  partner.total_taps,
                                ) === 'inactive'
                              ? 'Inactive'
                              : 'No Taps'
                      }
                    />
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs text-gray-500">Review:</span>
                    {partner.google_review_url ? (
                      <StatusBadge
                        status={getStationStatus(partner.last_review_tap_at, 1)}
                        label={
                          getStationStatus(partner.last_review_tap_at, 1) ===
                          'active'
                            ? 'Active'
                            : getStationStatus(
                                  partner.last_review_tap_at,
                                  1,
                                ) === 'warning'
                              ? 'Check In'
                              : getStationStatus(
                                    partner.last_review_tap_at,
                                    1,
                                  ) === 'inactive'
                                ? 'Inactive'
                                : 'No Taps'
                        }
                      />
                    ) : (
                      <StatusBadge status="not_configured" label="Not Set Up" />
                    )}
                  </div>
                </div>

                {/* Stats Grid */}
                <div className="mt-4 grid grid-cols-2 gap-2 sm:mt-6 sm:gap-4 md:grid-cols-6">
                  <div className="rounded-lg bg-blue-50 p-3 sm:p-4 dark:bg-blue-900/20">
                    <div className="text-lg font-bold text-blue-600 sm:text-2xl">
                      {partner.total_taps || 0}
                    </div>
                    <div className="text-xs text-blue-600/80">Taps</div>
                  </div>

                  <div className="rounded-lg bg-green-50 p-3 sm:p-4 dark:bg-green-900/20">
                    <div className="text-lg font-bold text-green-600 sm:text-2xl">
                      {partner.total_conversions || 0}
                    </div>
                    <div className="text-xs text-green-600/80">Jobs</div>
                  </div>

                  <div className="rounded-lg bg-purple-50 p-3 sm:p-4 dark:bg-purple-900/20">
                    <div className="text-lg font-bold text-purple-600 sm:text-2xl">
                      {conversionRate(
                        partner.total_taps,
                        partner.total_conversions,
                      )}
                    </div>
                    <div className="text-xs text-purple-600/80">Rate</div>
                  </div>

                  <div className="rounded-lg bg-amber-50 p-3 sm:p-4 dark:bg-amber-900/20">
                    <div className="text-lg font-bold text-amber-600 sm:text-2xl">
                      {partner.coupon_code || 'N/A'}
                    </div>
                    <div className="text-xs text-amber-600/80">Coupon</div>
                  </div>

                  <div className="col-span-2 rounded-lg bg-gray-50 p-3 sm:col-span-1 sm:p-4 md:col-span-2 dark:bg-gray-800">
                    <div className="text-xs font-semibold text-gray-600 dark:text-gray-400">
                      {partner.phone || 'No phone'}
                    </div>
                    <div className="text-xs text-gray-500">
                      {partner.card_id || 'No card ID'}
                    </div>
                  </div>
                </div>

                {/* Station URLs */}
                <div className="mt-3 grid grid-cols-1 gap-2 sm:mt-4 sm:grid-cols-2">
                  {/* Sasquatch Station URL */}
                  <div className="rounded-lg bg-blue-50 p-2 sm:p-3 dark:bg-blue-900/20">
                    <div className="mb-1 flex items-center justify-between">
                      <span className="text-xs font-semibold text-blue-700 dark:text-blue-300">
                        Sasquatch Station
                      </span>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 px-2 text-xs"
                        onClick={() => copyUrl(partner.id)}
                      >
                        {copiedId === partner.id ? (
                          '✓'
                        ) : (
                          <Copy className="h-3 w-3" />
                        )}
                      </Button>
                    </div>
                    <code className="block overflow-x-auto text-xs whitespace-nowrap text-blue-600 dark:text-blue-400">
                      /tap?partner={partner.id}
                    </code>
                  </div>

                  {/* Google Review Station URL */}
                  <div
                    className={`rounded-lg p-2 sm:p-3 ${partner.google_review_url ? 'bg-green-50 dark:bg-green-900/20' : 'bg-gray-100 dark:bg-gray-800'}`}
                  >
                    <div className="mb-1 flex items-center justify-between">
                      <span
                        className={`text-xs font-semibold ${partner.google_review_url ? 'text-green-700 dark:text-green-300' : 'text-gray-500'}`}
                      >
                        Google Review Station
                      </span>
                      {partner.google_review_url ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 px-2 text-xs"
                          onClick={() => copyReviewUrl(partner.id)}
                        >
                          {copiedReviewId === partner.id ? (
                            '✓'
                          ) : (
                            <Copy className="h-3 w-3" />
                          )}
                        </Button>
                      ) : null}
                    </div>
                    {partner.google_review_url ? (
                      <code className="block overflow-x-auto text-xs whitespace-nowrap text-green-600 dark:text-green-400">
                        /review/{partner.id}
                      </code>
                    ) : (
                      <span className="text-xs text-gray-400 italic">
                        Not configured
                      </span>
                    )}
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
