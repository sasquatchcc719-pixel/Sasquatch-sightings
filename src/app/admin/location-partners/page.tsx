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
  CheckCircle,
  Clock,
  ExternalLink,
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

interface PendingConversion {
  id: string
  partner_id: string
  conversion_type: string | null
  location_city: string | null
  tapped_at: string
  converted: boolean
}

export default function LocationPartnersPage() {
  const [partners, setPartners] = useState<LocationPartner[]>([])
  const [pendingConversions, setPendingConversions] = useState<
    PendingConversion[]
  >([])
  const [isLoading, setIsLoading] = useState(true)
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [confirmingId, setConfirmingId] = useState<string | null>(null)
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
      const supabase = createClient()

      // Fetch partners
      const { data: partnersData, error: partnersError } = await supabase
        .from('partners')
        .select('*')
        .eq('partner_type', 'location')
        .order('created_at', { ascending: false })

      if (partnersError) {
        console.error('Failed to load location partners:', partnersError)
      } else {
        setPartners(partnersData || [])
      }

      // Fetch pending conversions (taps with conversion_type but not confirmed)
      const { data: conversionsData, error: conversionsError } = await supabase
        .from('nfc_card_taps')
        .select(
          'id, partner_id, conversion_type, location_city, tapped_at, converted',
        )
        .not('partner_id', 'is', null)
        .not('conversion_type', 'is', null)
        .eq('converted', false)
        .order('tapped_at', { ascending: false })

      if (conversionsError) {
        console.error('Failed to load pending conversions:', conversionsError)
      } else {
        setPendingConversions(conversionsData || [])
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

    const { data: conversionsData } = await supabase
      .from('nfc_card_taps')
      .select(
        'id, partner_id, conversion_type, location_city, tapped_at, converted',
      )
      .not('partner_id', 'is', null)
      .not('conversion_type', 'is', null)
      .eq('converted', false)
      .order('tapped_at', { ascending: false })

    setPendingConversions(conversionsData || [])
  }

  const handleConfirmConversion = async (tapId: string, partnerId: string) => {
    setConfirmingId(tapId)

    try {
      const response = await fetch('/api/admin/location-partners/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tapId, partnerId }),
      })

      if (response.ok) {
        const data = await response.json()
        alert(
          `Confirmed! Partner awarded $${data.creditAwarded}. New balance: $${data.newBalance}`,
        )
        void loadData()
      } else {
        const error = await response.json()
        alert('Failed to confirm: ' + error.error)
      }
    } catch (error) {
      console.error('Failed to confirm conversion:', error)
      alert('Failed to confirm conversion')
    } finally {
      setConfirmingId(null)
    }
  }

  const handleCreatePartner = async (e: React.FormEvent) => {
    e.preventDefault()

    const supabase = createClient()

    const { data, error } = await supabase
      .from('partners')
      .insert({
        company_name: newPartner.company_name,
        location_name: newPartner.location_name || null,
        location_address: newPartner.location_address || null,
        location_type: newPartner.location_type || null,
        phone: newPartner.phone || null,
        card_id: newPartner.card_id || null,
        partner_type: 'location',
        role: 'partner',
        credit_balance: 0,
        total_taps: 0,
        total_conversions: 0,
      })
      .select()
      .single()

    if (error) {
      alert('Failed to create location partner: ' + error.message)
      return
    }

    if (newPartner.phone && data) {
      try {
        await fetch('/api/sms/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            to: newPartner.phone,
            message: `Welcome to Sasquatch Location Partners! Your NFC card is active. URL: ${window.location.origin}/location/${data.id}. You&apos;ll earn $5 credit for every confirmed booking!`,
          }),
        })
      } catch (error) {
        console.error('Failed to send welcome SMS:', error)
      }
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
  }

  const copyUrl = (partnerId: string) => {
    const url = `${window.location.origin}/location/${partnerId}`
    void navigator.clipboard.writeText(url)
    setCopiedId(partnerId)
    setTimeout(() => setCopiedId(null), 2000)
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

  const getPartnerName = (partnerId: string) => {
    const partner = partners.find((p) => p.id === partnerId)
    return partner?.location_name || partner?.company_name || 'Unknown'
  }

  if (isLoading) {
    return (
      <div className="p-8">
        <p className="text-gray-500">Loading location partners...</p>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 p-8 dark:bg-gray-900">
      <div className="mx-auto max-w-7xl">
        {/* Header */}
        <div className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold">Location Partners</h1>
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
            Add Location Partner
          </Button>
        </div>

        {/* Pending Conversions Alert */}
        {pendingConversions.length > 0 && (
          <Card className="mb-8 border-2 border-yellow-400 bg-yellow-50 p-6 dark:border-yellow-600 dark:bg-yellow-900/20">
            <div className="mb-4 flex items-center gap-2">
              <Clock className="h-5 w-5 text-yellow-600" />
              <h2 className="text-xl font-bold text-yellow-800 dark:text-yellow-200">
                Pending Confirmations ({pendingConversions.length})
              </h2>
            </div>
            <p className="mb-4 text-sm text-yellow-700 dark:text-yellow-300">
              These customers engaged with a location partner&apos;s NFC card.
              Confirm when the job is actually booked to award the partner $5
              credit.
            </p>
            <div className="space-y-3">
              {pendingConversions.map((conversion) => (
                <div
                  key={conversion.id}
                  className="flex items-center justify-between rounded-lg bg-white p-4 shadow-sm dark:bg-gray-800"
                >
                  <div>
                    <div className="font-semibold">
                      {getPartnerName(conversion.partner_id)}
                    </div>
                    <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
                      <Badge variant="outline">
                        {conversion.conversion_type === 'text_chat'
                          ? '💬 Started Chat'
                          : conversion.conversion_type === 'booking'
                            ? '📅 Clicked Book'
                            : '📝 Submitted Form'}
                      </Badge>
                      {conversion.location_city && (
                        <span>• {conversion.location_city}</span>
                      )}
                      <span>• {formatDate(conversion.tapped_at)}</span>
                    </div>
                  </div>
                  <Button
                    size="sm"
                    className="bg-green-600 hover:bg-green-700"
                    onClick={() =>
                      handleConfirmConversion(
                        conversion.id,
                        conversion.partner_id,
                      )
                    }
                    disabled={confirmingId === conversion.id}
                  >
                    {confirmingId === conversion.id ? (
                      'Confirming...'
                    ) : (
                      <>
                        <CheckCircle className="mr-1 h-4 w-4" />
                        Confirm Booking (+$5)
                      </>
                    )}
                  </Button>
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
                <h2 className="text-2xl font-bold">Create Location Partner</h2>
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
                    They&apos;ll receive SMS when they earn $5 credit
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
                  Create Location Partner
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
              ${partners.reduce((sum, p) => sum + (p.credit_balance || 0), 0)}
            </div>
            <div className="text-sm text-gray-600 dark:text-gray-400">
              Total Credits Awarded
            </div>
          </Card>
        </div>

        {/* Partners List */}
        {partners.length === 0 ? (
          <Card className="p-12 text-center">
            <MapPin className="mx-auto mb-4 h-12 w-12 text-gray-400" />
            <h3 className="mb-2 text-lg font-semibold">
              No location partners yet
            </h3>
            <p className="mb-4 text-sm text-gray-600 dark:text-gray-400">
              Add your first location partner to start tracking NFC card taps
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

                  <div className="rounded-lg bg-yellow-50 p-4 dark:bg-yellow-900/20">
                    <div className="text-2xl font-bold text-yellow-600">
                      ${partner.credit_balance || 0}
                    </div>
                    <div className="text-xs text-yellow-600/80">
                      Credits Earned
                    </div>
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
