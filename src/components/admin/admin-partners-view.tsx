'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Users,
  DollarSign,
  Plus,
  CheckCircle,
  Clock,
  CalendarCheck,
  X,
} from 'lucide-react'

type Partner = {
  id: string
  name: string
  email: string
  phone: string
  company_name: string
  company_website: string | null
  credit_balance: number
  backlink_opted_in: boolean
  backlink_verified: boolean
  created_at: string
}

type Referral = {
  id: string
  partner_id: string
  client_name: string
  client_phone: string
  notes: string | null
  status: 'pending' | 'booked' | 'converted'
  credit_amount: number
  created_at: string
  partners: {
    id: string
    name: string
    company_name: string
  }
}

type AdminPartnersViewProps = {
  partners: Partner[]
  referrals: Referral[]
}

export function AdminPartnersView({
  partners,
  referrals,
}: AdminPartnersViewProps) {
  const router = useRouter()

  // Filters
  const [partnerFilter, setPartnerFilter] = useState<string>('all')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [backlinkFilter, setBacklinkFilter] = useState<string>('all')

  // Add Referral Modal
  const [showAddReferral, setShowAddReferral] = useState(false)
  const [addReferralPartnerId, setAddReferralPartnerId] = useState('')
  const [addReferralClientName, setAddReferralClientName] = useState('')
  const [addReferralClientPhone, setAddReferralClientPhone] = useState('')
  const [addReferralNotes, setAddReferralNotes] = useState('')
  const [isAddingReferral, setIsAddingReferral] = useState(false)

  // Adjust Balance Modal
  const [showAdjustBalance, setShowAdjustBalance] = useState(false)
  const [adjustPartnerId, setAdjustPartnerId] = useState('')
  const [adjustAmount, setAdjustAmount] = useState('')
  const [adjustReason, setAdjustReason] = useState('')
  const [isAdjusting, setIsAdjusting] = useState(false)
  const [adjustMode, setAdjustMode] = useState<'add' | 'subtract'>('add')

  // Filter referrals
  const filteredReferrals = referrals.filter((r) => {
    if (partnerFilter !== 'all' && r.partner_id !== partnerFilter) return false
    if (statusFilter !== 'all' && r.status !== statusFilter) return false
    return true
  })

  const handleAddReferral = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsAddingReferral(true)

    try {
      const partner = partners.find((p) => p.id === addReferralPartnerId)
      const creditAmount = partner?.backlink_verified ? 25 : 20

      // Use API route to bypass RLS
      const response = await fetch('/api/admin/referrals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          partner_id: addReferralPartnerId,
          client_name: addReferralClientName,
          client_phone: addReferralClientPhone,
          notes: addReferralNotes || null,
          credit_amount: creditAmount,
        }),
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to add referral')
      }

      setShowAddReferral(false)
      setAddReferralPartnerId('')
      setAddReferralClientName('')
      setAddReferralClientPhone('')
      setAddReferralNotes('')
      router.refresh()
    } catch (error) {
      console.error('Error adding referral:', error)
      alert('Failed to add referral')
    } finally {
      setIsAddingReferral(false)
    }
  }

  const handleAdjustBalance = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsAdjusting(true)

    try {
      const partner = partners.find((p) => p.id === adjustPartnerId)
      if (!partner) throw new Error('Partner not found')

      const amount = parseFloat(adjustAmount)
      const newBalance = adjustMode === 'add' 
        ? partner.credit_balance + amount 
        : Math.max(0, partner.credit_balance - amount)

      console.log('Adjusting balance:', { partner_id: adjustPartnerId, new_balance: newBalance })
      
      const response = await fetch('/api/admin/partners', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          partner_id: adjustPartnerId,
          new_balance: newBalance,
        }),
      })

      const result = await response.json()
      console.log('API response:', result)

      if (!response.ok) {
        throw new Error(result.error || 'Failed to adjust balance')
      }

      setShowAdjustBalance(false)
      setAdjustPartnerId('')
      setAdjustAmount('')
      setAdjustReason('')
      setAdjustMode('add')
      router.refresh()
    } catch (error) {
      console.error('Error adjusting balance:', error)
      alert('Failed to adjust balance')
    } finally {
      setIsAdjusting(false)
    }
  }

  const handleVerifyBacklink = async (partnerId: string) => {
    try {
      const response = await fetch('/api/admin/partners', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          partner_id: partnerId,
          backlink_verified: true,
        }),
      })

      if (!response.ok) throw new Error('Failed to verify backlink')

      alert('Backlink verified! Partner now earns $25 per referral.')
      router.refresh()
    } catch (error) {
      console.error('Error verifying backlink:', error)
      alert('Failed to verify backlink')
    }
  }

  const handleRejectBacklink = async (partnerId: string) => {
    if (!confirm('Reject this backlink? The partner will stay at $20/referral rate.')) return

    try {
      const response = await fetch('/api/admin/partners', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          partner_id: partnerId,
          backlink_opted_in: false,
          backlink_verified: false,
        }),
      })

      if (!response.ok) throw new Error('Failed to reject backlink')

      alert('Backlink rejected. Partner removed from program.')
      router.refresh()
    } catch (error) {
      console.error('Error rejecting backlink:', error)
      alert('Failed to reject backlink')
    }
  }

  const handleDeleteReferral = async (referralId: string) => {
    if (!confirm('Are you sure you want to delete this referral?')) return

    try {
      const response = await fetch(`/api/admin/referrals?id=${referralId}`, {
        method: 'DELETE',
      })

      if (!response.ok) {
        throw new Error('Failed to delete referral')
      }

      router.refresh()
    } catch (error) {
      console.error('Error deleting referral:', error)
      alert('Failed to delete referral')
    }
  }

  const handleUpdateStatus = async (referralId: string, newStatus: string) => {
    try {
      const referral = referrals.find((r) => r.id === referralId)
      
      const response = await fetch('/api/admin/referrals', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          referral_id: referralId,
          status: newStatus,
          previous_status: referral?.status,
          partner_id: referral?.partner_id,
          credit_amount: referral?.credit_amount,
        }),
      })

      if (!response.ok) {
        throw new Error('Failed to update status')
      }

      router.refresh()
    } catch (error) {
      console.error('Error updating status:', error)
      alert('Failed to update status')
    }
  }

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'pending':
        return (
          <Badge variant="secondary" className="bg-yellow-100 text-yellow-800">
            <Clock className="mr-1 h-3 w-3" />
            Pending
          </Badge>
        )
      case 'booked':
        return (
          <Badge variant="secondary" className="bg-blue-100 text-blue-800">
            <CalendarCheck className="mr-1 h-3 w-3" />
            Booked
          </Badge>
        )
      case 'converted':
        return (
          <Badge variant="secondary" className="bg-green-100 text-green-800">
            <CheckCircle className="mr-1 h-3 w-3" />
            Converted
          </Badge>
        )
      default:
        return <Badge>{status}</Badge>
    }
  }

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'numeric',
      day: 'numeric',
    })
  }

  return (
    <div className="space-y-6">
      {/* Stats Overview */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Partners</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{partners.length}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Referrals</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{referrals.length}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Outstanding Credits
            </CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">
              ${partners.reduce((sum, p) => sum + p.credit_balance, 0).toFixed(2)}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* All Referrals */}
      <Card>
        <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle>All Referrals</CardTitle>
            <CardDescription>Manage partner referrals</CardDescription>
          </div>
          <Button onClick={() => setShowAddReferral(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Add Referral
          </Button>
        </CardHeader>
        <CardContent>
          {/* Filters */}
          <div className="mb-4 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:gap-4">
            <div className="col-span-1 sm:w-48">
              <Select value={partnerFilter} onValueChange={setPartnerFilter}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Filter by partner" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Partners</SelectItem>
                  {partners.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="col-span-1 sm:w-48">
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Filter by status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Statuses</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="booked">Booked</SelectItem>
                  <SelectItem value="converted">Converted</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Referrals - Cards on mobile, Table on desktop */}
          {filteredReferrals.length === 0 ? (
            <div className="py-8 text-center text-muted-foreground">
              No referrals found
            </div>
          ) : (
            <>
              {/* Mobile: Card Layout */}
              <div className="space-y-3 md:hidden">
                {filteredReferrals.map((referral) => (
                  <div key={referral.id} className="rounded-lg border bg-card p-4">
                    <div className="mb-3 flex items-start justify-between">
                      <div>
                        <div className="font-semibold">{referral.client_name}</div>
                        <a 
                          href={`tel:${referral.client_phone}`} 
                          className="text-sm text-blue-400"
                        >
                          {referral.client_phone}
                        </a>
                      </div>
                      {getStatusBadge(referral.status)}
                    </div>
                    <div className="mb-3 text-sm text-muted-foreground">
                      <span className="font-medium text-foreground">{referral.partners?.name}</span>
                      {' · '}{referral.partners?.company_name}
                    </div>
                    <div className="flex items-center justify-between">
                      <div className="text-sm">
                        <span className="font-medium">${referral.credit_amount.toFixed(2)}</span>
                        <span className="text-muted-foreground"> · {formatDate(referral.created_at)}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Select
                          value={referral.status}
                          onValueChange={(value) => handleUpdateStatus(referral.id, value)}
                        >
                          <SelectTrigger className="h-8 w-24 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="pending">Pending</SelectItem>
                            <SelectItem value="booked">Booked</SelectItem>
                            <SelectItem value="converted">Converted</SelectItem>
                          </SelectContent>
                        </Select>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDeleteReferral(referral.id)}
                          className="h-8 w-8 p-0 text-red-500"
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Desktop: Table Layout */}
              <div className="hidden overflow-x-auto md:block">
                <table className="w-full">
                  <thead>
                    <tr className="border-b text-left text-sm text-muted-foreground">
                      <th className="pb-3 pr-4 font-medium">Partner</th>
                      <th className="pb-3 pr-4 font-medium">Client</th>
                      <th className="pb-3 pr-4 font-medium">Phone</th>
                      <th className="pb-3 pr-4 font-medium">Status</th>
                      <th className="pb-3 pr-4 font-medium">Credit</th>
                      <th className="hidden pb-3 pr-4 font-medium lg:table-cell">Date</th>
                      <th className="pb-3 font-medium">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredReferrals.map((referral) => (
                      <tr key={referral.id} className="border-b">
                        <td className="py-3 pr-4">
                          <div>
                            <div className="font-medium">
                              {referral.partners?.name}
                            </div>
                            <div className="text-sm text-muted-foreground">
                              {referral.partners?.company_name}
                            </div>
                          </div>
                        </td>
                        <td className="py-3 pr-4 font-medium">
                          {referral.client_name}
                        </td>
                        <td className="py-3 pr-4">
                          <a 
                            href={`tel:${referral.client_phone}`} 
                            className="text-blue-400 hover:text-blue-300 hover:underline"
                          >
                            {referral.client_phone}
                          </a>
                        </td>
                        <td className="py-3 pr-4">{getStatusBadge(referral.status)}</td>
                        <td className="py-3 pr-4">
                          ${referral.credit_amount.toFixed(2)}
                        </td>
                        <td className="hidden py-3 pr-4 text-muted-foreground lg:table-cell">
                          {formatDate(referral.created_at)}
                        </td>
                        <td className="py-3">
                          <div className="flex items-center gap-2">
                            <Select
                              value={referral.status}
                              onValueChange={(value) =>
                                handleUpdateStatus(referral.id, value)
                              }
                            >
                              <SelectTrigger className="w-28">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="pending">Pending</SelectItem>
                                <SelectItem value="booked">Booked</SelectItem>
                                <SelectItem value="converted">Converted</SelectItem>
                              </SelectContent>
                            </Select>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleDeleteReferral(referral.id)}
                              className="text-red-500 hover:text-red-400 hover:bg-red-500/10"
                            >
                              <X className="h-4 w-4" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Partner Balances */}
      <Card>
        <CardHeader>
          <CardTitle>Partner Balances</CardTitle>
          <CardDescription>View and adjust partner credit balances</CardDescription>
        </CardHeader>
        <CardContent>
          {partners.length === 0 ? (
            <div className="py-8 text-center text-muted-foreground">
              No partners yet
            </div>
          ) : (
            <>
              {/* Mobile: Card Layout */}
              <div className="space-y-3 md:hidden">
                {partners.map((partner) => (
                  <div key={partner.id} className="rounded-lg border bg-card p-4">
                    <div className="mb-2 flex items-start justify-between">
                      <div>
                        <div className="font-semibold">{partner.name}</div>
                        <div className="text-sm text-muted-foreground">{partner.company_name}</div>
                      </div>
                      <div className="text-right">
                        <div className="text-lg font-bold text-green-500">
                          ${partner.credit_balance.toFixed(2)}
                        </div>
                        {partner.backlink_opted_in && (
                          partner.backlink_verified ? (
                            <Badge className="bg-green-100 text-green-800 text-xs">Verified</Badge>
                          ) : (
                            <Badge className="bg-yellow-100 text-yellow-800 text-xs">Pending</Badge>
                          )
                        )}
                      </div>
                    </div>
                    <div className="mb-2 flex items-center justify-between">
                      <a 
                        href={`mailto:${partner.email}`}
                        className="text-sm text-blue-400"
                      >
                        {partner.email}
                      </a>
                    </div>
                    <div className="mb-3 flex items-center justify-between">
                      <a 
                        href={`tel:${partner.phone}`}
                        className="text-sm text-blue-400"
                      >
                        {partner.phone}
                      </a>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setAdjustPartnerId(partner.id)
                          setShowAdjustBalance(true)
                        }}
                      >
                        Adjust
                      </Button>
                    </div>
                  </div>
                ))}
              </div>

              {/* Desktop: Table Layout */}
              <div className="hidden overflow-x-auto md:block">
                <table className="w-full">
                  <thead>
                    <tr className="border-b text-left text-sm text-muted-foreground">
                      <th className="pb-3 pr-4 font-medium">Partner</th>
                      <th className="pb-3 pr-4 font-medium">Company</th>
                      <th className="pb-3 pr-4 font-medium">Phone</th>
                      <th className="pb-3 pr-4 font-medium">Balance</th>
                      <th className="pb-3 pr-4 font-medium">Backlink</th>
                      <th className="pb-3 font-medium">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {partners.map((partner) => (
                      <tr key={partner.id} className="border-b">
                        <td className="py-3 pr-4">
                          <div>
                            <div className="font-medium">{partner.name}</div>
                            <a 
                              href={`mailto:${partner.email}`}
                              className="text-sm text-blue-400 hover:text-blue-300 hover:underline"
                            >
                              {partner.email}
                            </a>
                          </div>
                        </td>
                        <td className="py-3 pr-4">{partner.company_name}</td>
                        <td className="py-3 pr-4">
                          <a 
                            href={`tel:${partner.phone}`}
                            className="text-blue-400 hover:text-blue-300 hover:underline"
                          >
                            {partner.phone}
                          </a>
                        </td>
                        <td className="py-3 pr-4 font-medium">
                          ${partner.credit_balance.toFixed(2)}
                        </td>
                        <td className="py-3 pr-4">
                          {partner.backlink_opted_in ? (
                            partner.backlink_verified ? (
                              <Badge className="bg-green-100 text-green-800">
                                Verified
                              </Badge>
                            ) : (
                              <Badge className="bg-yellow-100 text-yellow-800">
                                Pending
                              </Badge>
                            )
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="py-3">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              setAdjustPartnerId(partner.id)
                              setShowAdjustBalance(true)
                            }}
                          >
                            Adjust
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Backlink Verifications */}
      <Card>
        <CardHeader>
          <CardTitle>Backlink Verifications</CardTitle>
          <CardDescription>Verify partner backlinks to enable $25/referral rate</CardDescription>
        </CardHeader>
        <CardContent>
          {/* Filter */}
          <div className="mb-4">
            <Select value={backlinkFilter} onValueChange={setBacklinkFilter}>
              <SelectTrigger className="w-full sm:w-48">
                <SelectValue placeholder="Filter by status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Partners</SelectItem>
                <SelectItem value="pending">Pending Only</SelectItem>
                <SelectItem value="verified">Verified Only</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {partners.filter((p) => {
            if (backlinkFilter === 'pending') return p.backlink_opted_in && !p.backlink_verified
            if (backlinkFilter === 'verified') return p.backlink_verified
            return true
          }).length === 0 ? (
            <div className="py-8 text-center text-muted-foreground">
              {backlinkFilter === 'pending' ? 'No pending verifications' : 'No partners found'}
            </div>
          ) : (
            <>
              {/* Mobile: Card Layout */}
              <div className="space-y-3 md:hidden">
                {partners
                  .filter((p) => {
                    if (backlinkFilter === 'pending') return p.backlink_opted_in && !p.backlink_verified
                    if (backlinkFilter === 'verified') return p.backlink_verified
                    return true
                  })
                  .map((partner) => (
                    <div key={partner.id} className="rounded-lg border bg-card p-4">
                      <div className="mb-2 flex items-start justify-between">
                        <div>
                          <div className="font-semibold">{partner.name}</div>
                          <div className="text-sm text-muted-foreground">{partner.company_name}</div>
                        </div>
                        <div>
                          {!partner.backlink_opted_in ? (
                            <span className="text-sm text-muted-foreground">❌ Not enrolled</span>
                          ) : !partner.backlink_verified ? (
                            <span className="text-sm text-yellow-500">⏳ Pending</span>
                          ) : (
                            <span className="text-sm text-green-500">✅ Verified</span>
                          )}
                        </div>
                      </div>
                      {partner.company_website && (
                        <a
                          href={partner.company_website.startsWith('http') ? partner.company_website : `https://${partner.company_website}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="mb-3 block text-sm text-blue-400"
                        >
                          {partner.company_website.replace(/^https?:\/\//, '').replace(/\/$/, '')}
                        </a>
                      )}
                      {partner.backlink_opted_in && !partner.backlink_verified && (
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            onClick={() => handleVerifyBacklink(partner.id)}
                            className="flex-1 bg-green-600 hover:bg-green-500"
                          >
                            ✓ Verify
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleRejectBacklink(partner.id)}
                            className="flex-1 text-red-500 hover:text-red-400"
                          >
                            ✗ Reject
                          </Button>
                        </div>
                      )}
                    </div>
                  ))}
              </div>

              {/* Desktop: Table Layout */}
              <div className="hidden overflow-x-auto md:block">
                <table className="w-full">
                  <thead>
                    <tr className="border-b text-left text-sm text-muted-foreground">
                      <th className="pb-3 pr-4 font-medium">Partner</th>
                      <th className="pb-3 pr-4 font-medium">Company</th>
                      <th className="pb-3 pr-4 font-medium">Website</th>
                      <th className="pb-3 pr-4 font-medium">Status</th>
                      <th className="pb-3 font-medium">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {partners
                      .filter((p) => {
                        if (backlinkFilter === 'pending') return p.backlink_opted_in && !p.backlink_verified
                        if (backlinkFilter === 'verified') return p.backlink_verified
                        return true
                      })
                      .map((partner) => (
                        <tr key={partner.id} className="border-b">
                          <td className="py-3 pr-4 font-medium">{partner.name}</td>
                          <td className="py-3 pr-4">{partner.company_name}</td>
                          <td className="py-3 pr-4">
                            {partner.company_website ? (
                              <a
                                href={partner.company_website.startsWith('http') ? partner.company_website : `https://${partner.company_website}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-blue-400 hover:text-blue-300 hover:underline"
                              >
                                {partner.company_website.replace(/^https?:\/\//, '').replace(/\/$/, '')}
                              </a>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </td>
                          <td className="py-3 pr-4">
                            {!partner.backlink_opted_in ? (
                              <span className="flex items-center gap-1 text-muted-foreground">
                                ❌ Not enrolled
                              </span>
                            ) : !partner.backlink_verified ? (
                              <span className="flex items-center gap-1 text-yellow-500">
                                ⏳ Pending
                              </span>
                            ) : (
                              <span className="flex items-center gap-1 text-green-500">
                                ✅ Verified
                              </span>
                            )}
                          </td>
                          <td className="py-3">
                            {partner.backlink_opted_in && !partner.backlink_verified && (
                              <div className="flex gap-2">
                                <Button
                                  size="sm"
                                  onClick={() => handleVerifyBacklink(partner.id)}
                                  className="bg-green-600 hover:bg-green-500"
                                >
                                  ✓ Verify
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => handleRejectBacklink(partner.id)}
                                  className="text-red-500 hover:text-red-400"
                                >
                                  ✗ Reject
                                </Button>
                              </div>
                            )}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Add Referral Modal */}
      {showAddReferral && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <Card className="w-full max-w-md">
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>Add Referral</CardTitle>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowAddReferral(false)}
              >
                <X className="h-4 w-4" />
              </Button>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleAddReferral} className="space-y-4">
                <div className="grid gap-2">
                  <Label>Partner *</Label>
                  <Select
                    value={addReferralPartnerId}
                    onValueChange={setAddReferralPartnerId}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select partner" />
                    </SelectTrigger>
                    <SelectContent>
                      {partners.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.name} ({p.company_name})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    Partner not listed? Have them register at /partners/register
                  </p>
                </div>

                <div className="grid gap-2">
                  <Label>Client Name *</Label>
                  <Input
                    value={addReferralClientName}
                    onChange={(e) => setAddReferralClientName(e.target.value)}
                    placeholder="Jane Doe"
                    required
                  />
                </div>

                <div className="grid gap-2">
                  <Label>Client Phone *</Label>
                  <Input
                    value={addReferralClientPhone}
                    onChange={(e) => setAddReferralClientPhone(e.target.value)}
                    placeholder="(555) 123-4567"
                    required
                  />
                </div>

                <div className="grid gap-2">
                  <Label>Notes</Label>
                  <Textarea
                    value={addReferralNotes}
                    onChange={(e) => setAddReferralNotes(e.target.value)}
                    placeholder="Any additional notes..."
                    rows={3}
                  />
                </div>

                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setShowAddReferral(false)}
                    className="flex-1"
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    disabled={isAddingReferral || !addReferralPartnerId}
                    className="flex-1"
                  >
                    {isAddingReferral ? 'Adding...' : 'Add Referral'}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Adjust Balance Modal */}
      {showAdjustBalance && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <Card className="w-full max-w-md">
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>Adjust Balance</CardTitle>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowAdjustBalance(false)}
              >
                <X className="h-4 w-4" />
              </Button>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleAdjustBalance} className="space-y-4">
                <div className="rounded-lg bg-muted p-3">
                  <p className="text-sm">
                    <strong>Partner:</strong>{' '}
                    {partners.find((p) => p.id === adjustPartnerId)?.name}
                  </p>
                  <p className="text-sm">
                    <strong>Current Balance:</strong> $
                    {partners
                      .find((p) => p.id === adjustPartnerId)
                      ?.credit_balance.toFixed(2)}
                  </p>
                </div>

                <div className="grid gap-2">
                  <Label>Action</Label>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant={adjustMode === 'add' ? 'default' : 'outline'}
                      onClick={() => setAdjustMode('add')}
                      className="flex-1"
                    >
                      + Add Credit
                    </Button>
                    <Button
                      type="button"
                      variant={adjustMode === 'subtract' ? 'default' : 'outline'}
                      onClick={() => setAdjustMode('subtract')}
                      className="flex-1"
                    >
                      − Subtract
                    </Button>
                  </div>
                </div>

                <div className="grid gap-2">
                  <Label>Amount *</Label>
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    value={adjustAmount}
                    onChange={(e) => setAdjustAmount(e.target.value)}
                    placeholder="25.00"
                    required
                  />
                </div>

                <div className="grid gap-2">
                  <Label>Reason *</Label>
                  <Textarea
                    value={adjustReason}
                    onChange={(e) => setAdjustReason(e.target.value)}
                    placeholder="Reason for adjustment..."
                    rows={2}
                    required
                  />
                </div>

                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setShowAdjustBalance(false)}
                    className="flex-1"
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    disabled={isAdjusting || !adjustAmount}
                    className="flex-1"
                  >
                    {isAdjusting ? 'Saving...' : 'Save'}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}
