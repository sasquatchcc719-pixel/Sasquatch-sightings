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
  created_at: string
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
  })

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
    const supabase = createClient()

    const { data: partnersData } = await supabase
      .from('partners')
      .select('*')
      .eq('partner_type', 'location')
      .order('created_at', { ascending: false })

    setPartners(partnersData || [])
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
      })
      setIsDialogOpen(false)
      void loadData()
    } catch (error) {
      console.error('Failed to create location partner:', error)
      alert('Failed to create location partner')
    }
  }

  const copyUrl = (partnerId: string) => {
    const url = `${window.location.origin}/location/${partnerId}`
    void navigator.clipboard.writeText(url)
    setCopiedId(partnerId)
    setTimeout(() => setCopiedId(null), 2000)
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
      const supabase = createClient()
      const { error } = await supabase
        .from('partners')
        .delete()
        .eq('id', partnerId)

      if (error) {
        console.error('Failed to delete vendor:', error)
        alert('Failed to delete vendor: ' + error.message)
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
    <div className="min-h-screen bg-gray-50 p-8 dark:bg-gray-900">
      <div className="mx-auto max-w-7xl">
        {/* Header */}
        <div className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold">Vendors</h1>
            <p className="mt-2 text-gray-600 dark:text-gray-400">
              Manage NFC cards at local establishments
            </p>
          </div>
          <Button
            size="lg"
            className="bg-green-600 hover:bg-green-700"
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

                <Button type="submit" className="w-full">
                  Create Vendor
                </Button>
              </form>
            </Card>
          </div>
        )}

        {/* Stats Overview */}
        <div className="mb-8 grid gap-4 md:grid-cols-4">
          <Card className="p-6">
            <div className="text-2xl font-bold">{partners.length}</div>
            <div className="text-sm text-gray-600 dark:text-gray-400">
              Active Locations
            </div>
          </Card>
          <Card className="p-6">
            <div className="text-2xl font-bold">
              {partners.reduce((sum, p) => sum + (p.total_taps || 0), 0)}
            </div>
            <div className="text-sm text-gray-600 dark:text-gray-400">
              Total Taps
            </div>
          </Card>
          <Card className="p-6">
            <div className="text-2xl font-bold">
              {partners.reduce((sum, p) => sum + (p.total_conversions || 0), 0)}
            </div>
            <div className="text-sm text-gray-600 dark:text-gray-400">
              Confirmed Bookings
            </div>
          </Card>
          <Card className="p-6">
            <div className="text-2xl font-bold text-green-600">
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
            <div className="text-sm text-gray-600 dark:text-gray-400">
              Avg Conversion Rate
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
              <Card key={partner.id} className="p-6">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <h3 className="text-xl font-bold">
                      {partner.location_name || partner.company_name}
                    </h3>
                    {partner.location_address && (
                      <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
                        <MapPin className="mr-1 inline h-4 w-4" />
                        {partner.location_address}
                      </p>
                    )}
                    {partner.location_type && (
                      <p className="mt-1 text-xs tracking-wide text-gray-500 uppercase">
                        {partner.location_type}
                      </p>
                    )}
                  </div>

                  <div className="flex gap-2">
                    <a
                      href={`/location/${partner.id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <Button variant="outline" size="sm">
                        <ExternalLink className="mr-1 h-4 w-4" />
                        View Page
                      </Button>
                    </a>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => copyUrl(partner.id)}
                    >
                      {copiedId === partner.id ? (
                        <>✓ Copied</>
                      ) : (
                        <>
                          <Copy className="mr-2 h-4 w-4" />
                          Copy URL
                        </>
                      )}
                    </Button>
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

                {/* Stats Grid */}
                <div className="mt-6 grid gap-4 md:grid-cols-5">
                  <div className="rounded-lg bg-blue-50 p-4 dark:bg-blue-900/20">
                    <div className="text-2xl font-bold text-blue-600">
                      {partner.total_taps || 0}
                    </div>
                    <div className="text-xs text-blue-600/80">Total Taps</div>
                  </div>

                  <div className="rounded-lg bg-green-50 p-4 dark:bg-green-900/20">
                    <div className="text-2xl font-bold text-green-600">
                      {partner.total_conversions || 0}
                    </div>
                    <div className="text-xs text-green-600/80">
                      Confirmed Jobs
                    </div>
                  </div>

                  <div className="rounded-lg bg-purple-50 p-4 dark:bg-purple-900/20">
                    <div className="text-2xl font-bold text-purple-600">
                      {conversionRate(
                        partner.total_taps,
                        partner.total_conversions,
                      )}
                    </div>
                    <div className="text-xs text-purple-600/80">Conv. Rate</div>
                  </div>

                  <div className="rounded-lg bg-gray-50 p-4 dark:bg-gray-800">
                    <div className="text-xs font-semibold text-gray-600 dark:text-gray-400">
                      {partner.phone || 'No phone'}
                    </div>
                    <div className="text-xs text-gray-500">
                      {partner.card_id || 'No card ID'}
                    </div>
                  </div>
                </div>

                {/* Quick Link */}
                <div className="mt-4 rounded-lg bg-gray-50 p-3 dark:bg-gray-800">
                  <code className="text-xs text-gray-600 dark:text-gray-400">
                    {window.location.origin}/location/{partner.id}
                  </code>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
