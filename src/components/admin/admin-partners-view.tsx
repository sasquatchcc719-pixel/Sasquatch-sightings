'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/supabase/client'
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
  company_name: string
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

  // Filter referrals
  const filteredReferrals = referrals.filter((r) => {
    if (partnerFilter !== 'all' && r.partner_id !== partnerFilter) return false
    if (statusFilter !== 'all' && r.status !== statusFilter) return false
    return true
  })

  const handleAddReferral = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsAddingReferral(true)

    const supabase = createClient()

    try {
      const partner = partners.find((p) => p.id === addReferralPartnerId)
      const creditAmount = partner?.backlink_verified ? 25 : 20

      const { error } = await supabase.from('referrals').insert({
        partner_id: addReferralPartnerId,
        client_name: addReferralClientName,
        client_phone: addReferralClientPhone,
        notes: addReferralNotes || null,
        status: 'pending',
        credit_amount: creditAmount,
        booked_via_link: false,
      })

      if (error) throw error

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

    const supabase = createClient()

    try {
      const partner = partners.find((p) => p.id === adjustPartnerId)
      if (!partner) throw new Error('Partner not found')

      const newBalance = partner.credit_balance + parseFloat(adjustAmount)

      const { error } = await supabase
        .from('partners')
        .update({ credit_balance: newBalance })
        .eq('id', adjustPartnerId)

      if (error) throw error

      setShowAdjustBalance(false)
      setAdjustPartnerId('')
      setAdjustAmount('')
      setAdjustReason('')
      router.refresh()
    } catch (error) {
      console.error('Error adjusting balance:', error)
      alert('Failed to adjust balance')
    } finally {
      setIsAdjusting(false)
    }
  }

  const handleUpdateStatus = async (referralId: string, newStatus: string) => {
    const supabase = createClient()

    try {
      const updateData: Record<string, unknown> = { status: newStatus }
      if (newStatus === 'converted') {
        updateData.converted_at = new Date().toISOString()

        // Also add credit to partner
        const referral = referrals.find((r) => r.id === referralId)
        if (referral) {
          const partner = partners.find((p) => p.id === referral.partner_id)
          if (partner) {
            await supabase
              .from('partners')
              .update({
                credit_balance: partner.credit_balance + referral.credit_amount,
              })
              .eq('id', partner.id)
          }
        }
      }

      const { error } = await supabase
        .from('referrals')
        .update(updateData)
        .eq('id', referralId)

      if (error) throw error

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
      month: 'short',
      day: 'numeric',
      year: 'numeric',
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
          <div className="mb-4 flex flex-wrap gap-4">
            <div className="w-48">
              <Select value={partnerFilter} onValueChange={setPartnerFilter}>
                <SelectTrigger>
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

            <div className="w-48">
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger>
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

          {/* Referrals Table */}
          {filteredReferrals.length === 0 ? (
            <div className="py-8 text-center text-muted-foreground">
              No referrals found
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b text-left text-sm text-muted-foreground">
                    <th className="pb-3 font-medium">Partner</th>
                    <th className="pb-3 font-medium">Client</th>
                    <th className="pb-3 font-medium">Phone</th>
                    <th className="pb-3 font-medium">Status</th>
                    <th className="pb-3 font-medium">Credit</th>
                    <th className="pb-3 font-medium">Date</th>
                    <th className="pb-3 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredReferrals.map((referral) => (
                    <tr key={referral.id} className="border-b">
                      <td className="py-3">
                        <div>
                          <div className="font-medium">
                            {referral.partners?.name}
                          </div>
                          <div className="text-sm text-muted-foreground">
                            {referral.partners?.company_name}
                          </div>
                        </div>
                      </td>
                      <td className="py-3 font-medium">
                        {referral.client_name}
                      </td>
                      <td className="py-3 text-muted-foreground">
                        {referral.client_phone}
                      </td>
                      <td className="py-3">{getStatusBadge(referral.status)}</td>
                      <td className="py-3">
                        ${referral.credit_amount.toFixed(2)}
                      </td>
                      <td className="py-3 text-muted-foreground">
                        {formatDate(referral.created_at)}
                      </td>
                      <td className="py-3">
                        <Select
                          value={referral.status}
                          onValueChange={(value) =>
                            handleUpdateStatus(referral.id, value)
                          }
                        >
                          <SelectTrigger className="w-32">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="pending">Pending</SelectItem>
                            <SelectItem value="booked">Booked</SelectItem>
                            <SelectItem value="converted">Converted</SelectItem>
                          </SelectContent>
                        </Select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
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
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b text-left text-sm text-muted-foreground">
                    <th className="pb-3 font-medium">Partner</th>
                    <th className="pb-3 font-medium">Company</th>
                    <th className="pb-3 font-medium">Balance</th>
                    <th className="pb-3 font-medium">Backlink</th>
                    <th className="pb-3 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {partners.map((partner) => (
                    <tr key={partner.id} className="border-b">
                      <td className="py-3">
                        <div>
                          <div className="font-medium">{partner.name}</div>
                          <div className="text-sm text-muted-foreground">
                            {partner.email}
                          </div>
                        </div>
                      </td>
                      <td className="py-3">{partner.company_name}</td>
                      <td className="py-3 font-medium">
                        ${partner.credit_balance.toFixed(2)}
                      </td>
                      <td className="py-3">
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
          )}
        </CardContent>
      </Card>

      {/* Add Referral Modal */}
      {showAddReferral && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <Card className="w-full max-w-md">
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>Add Manual Referral</CardTitle>
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
                    required
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
                  <Label>Amount to Add/Subtract *</Label>
                  <Input
                    type="number"
                    step="0.01"
                    value={adjustAmount}
                    onChange={(e) => setAdjustAmount(e.target.value)}
                    placeholder="25.00 or -25.00"
                    required
                  />
                  <p className="text-xs text-muted-foreground">
                    Use negative numbers to subtract
                  </p>
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
