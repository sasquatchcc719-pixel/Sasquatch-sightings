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
  DollarSign,
  Users,
  CheckCircle,
  Clock,
  CalendarCheck,
  Send,
  ExternalLink,
  Gift,
  Inbox,
  Phone,
  Mail,
  FileText,
  Check,
  X,
} from 'lucide-react'

type Referral = {
  id: string
  client_name: string
  client_phone: string
  notes: string | null
  status: 'pending' | 'booked' | 'converted'
  credit_amount: number
  booked_via_link: boolean
  created_at: string
  converted_at: string | null
}

type OutboundReferral = {
  id: string
  client_name: string
  client_phone: string
  client_email: string | null
  description: string
  notes: string | null
  referral_fee: number
  status: 'pending' | 'accepted' | 'completed' | 'declined'
  created_at: string
  accepted_at: string | null
}

type Partner = {
  id: string
  name: string
  email: string
  company_name: string
  credit_balance: number
  backlink_opted_in: boolean
  backlink_verified: boolean
}

type Stats = {
  creditBalance: number
  totalReferrals: number
  convertedReferrals: number
  pendingReferrals: number
  bookedReferrals: number
}

type PartnerDashboardProps = {
  partner: Partner
  referrals: Referral[]
  incomingWork: OutboundReferral[]
  stats: Stats
}

export function PartnerDashboard({
  partner,
  referrals,
  incomingWork,
  stats,
}: PartnerDashboardProps) {
  const router = useRouter()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitSuccess, setSubmitSuccess] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  // Referral form state
  const [clientName, setClientName] = useState('')
  const [clientPhone, setClientPhone] = useState('')
  const [notes, setNotes] = useState('')

  // Incoming work state
  const [processingReferralId, setProcessingReferralId] = useState<
    string | null
  >(null)
  const [acceptedReferrals, setAcceptedReferrals] = useState<
    Record<
      string,
      {
        client_name: string
        client_phone: string
        client_email?: string
        notes?: string
      }
    >
  >({})
  const [workError, setWorkError] = useState<string | null>(null)

  // Filter incoming work to show pending ones
  const pendingIncomingWork = incomingWork.filter((r) => r.status === 'pending')
  const acceptedIncomingWork = incomingWork.filter(
    (r) => r.status === 'accepted' || r.status === 'completed',
  )

  const handleAcceptWork = async (referralId: string) => {
    setProcessingReferralId(referralId)
    setWorkError(null)

    try {
      const response = await fetch('/api/partners/outbound-referrals', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ referral_id: referralId, action: 'accept' }),
      })

      const result = await response.json()

      if (!response.ok) {
        throw new Error(result.error || 'Failed to accept referral')
      }

      // Store the client info to display
      setAcceptedReferrals((prev) => ({
        ...prev,
        [referralId]: {
          client_name: result.client_name,
          client_phone: result.client_phone,
          client_email: result.client_email,
          notes: result.notes,
        },
      }))

      router.refresh()
    } catch (error) {
      console.error('Error accepting work:', error)
      setWorkError(
        error instanceof Error ? error.message : 'Failed to accept work',
      )
    } finally {
      setProcessingReferralId(null)
    }
  }

  const handleDeclineWork = async (referralId: string) => {
    if (!confirm('Are you sure you want to decline this referral?')) return

    setProcessingReferralId(referralId)
    setWorkError(null)

    try {
      const response = await fetch('/api/partners/outbound-referrals', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ referral_id: referralId, action: 'decline' }),
      })

      if (!response.ok) {
        const result = await response.json()
        throw new Error(result.error || 'Failed to decline referral')
      }

      router.refresh()
    } catch (error) {
      console.error('Error declining work:', error)
      setWorkError(
        error instanceof Error ? error.message : 'Failed to decline work',
      )
    } finally {
      setProcessingReferralId(null)
    }
  }

  const handleSubmitReferral = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsSubmitting(true)
    setSubmitError(null)
    setSubmitSuccess(false)

    const supabase = createClient()

    try {
      const creditAmount = partner.backlink_verified ? 25 : 20

      const { error } = await supabase.from('referrals').insert({
        partner_id: partner.id,
        client_name: clientName,
        client_phone: clientPhone,
        notes: notes || null,
        status: 'pending',
        credit_amount: creditAmount,
        booked_via_link: false,
      })

      if (error) throw error

      setSubmitSuccess(true)
      setClientName('')
      setClientPhone('')
      setNotes('')

      // Refresh the page to show new referral
      router.refresh()
    } catch (error) {
      console.error('Error submitting referral:', error)
      setSubmitError('Failed to submit referral. Please try again.')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleBookForClient = async () => {
    if (!clientName || !clientPhone) {
      setSubmitError('Please enter client name and phone first')
      return
    }

    setIsSubmitting(true)
    setSubmitError(null)

    const supabase = createClient()

    try {
      const creditAmount = partner.backlink_verified ? 25 : 20

      // Create referral with booked status
      const { error } = await supabase.from('referrals').insert({
        partner_id: partner.id,
        client_name: clientName,
        client_phone: clientPhone,
        notes: notes || null,
        status: 'booked',
        credit_amount: creditAmount,
        booked_via_link: true,
      })

      if (error) throw error

      // Add credit to partner balance
      const { error: balanceError } = await supabase
        .from('partners')
        .update({ credit_balance: partner.credit_balance + creditAmount })
        .eq('id', partner.id)

      if (balanceError) {
        console.error('Error updating balance:', balanceError)
      }

      // Open HousecallPro in new tab
      // TODO: Add actual HousecallPro URL
      window.open('https://housecallpro.com', '_blank')

      setClientName('')
      setClientPhone('')
      setNotes('')
      router.refresh()
    } catch (error) {
      console.error('Error booking for client:', error)
      setSubmitError('Failed to create booking. Please try again.')
    } finally {
      setIsSubmitting(false)
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
    <div className="space-y-8">
      {/* Welcome Header */}
      <div className="text-white">
        <h1 className="text-3xl font-bold">Welcome back, {partner.name}!</h1>
        <p className="mt-1 text-white/70">{partner.company_name}</p>
      </div>

      {/* Incoming Work Section */}
      {pendingIncomingWork.length > 0 && (
        <Card className="border-orange-300 bg-orange-50 dark:border-orange-700 dark:bg-orange-900/30">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-orange-800 dark:text-orange-200">
              <Inbox className="h-5 w-5" />
              Incoming Work Referrals ({pendingIncomingWork.length})
            </CardTitle>
            <CardDescription className="text-orange-700 dark:text-orange-300">
              Sasquatch Carpet Cleaning wants to send you work!
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {workError && (
              <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-600">
                {workError}
              </div>
            )}

            {pendingIncomingWork.map((work) => (
              <div
                key={work.id}
                className="rounded-lg border border-orange-200 bg-white p-4 dark:border-orange-600 dark:bg-orange-900/20"
              >
                <div className="mb-3">
                  <h4 className="font-semibold text-orange-900 dark:text-orange-100">
                    {work.description}
                  </h4>
                  <p className="text-sm text-orange-700 dark:text-orange-300">
                    {work.referral_fee > 0
                      ? `Referral fee: $${work.referral_fee.toFixed(2)}`
                      : 'No referral fee'}
                  </p>
                  <p className="mt-1 text-xs text-orange-600 dark:text-orange-400">
                    Sent {new Date(work.created_at).toLocaleDateString()}
                  </p>
                </div>

                {acceptedReferrals[work.id] ? (
                  <div className="rounded-lg bg-green-100 p-3 dark:bg-green-900/30">
                    <p className="mb-2 font-medium text-green-800 dark:text-green-200">
                      ✓ Accepted! Here is the client info:
                    </p>
                    <div className="space-y-1 text-sm">
                      <p className="flex items-center gap-2">
                        <Users className="h-4 w-4" />
                        {acceptedReferrals[work.id].client_name}
                      </p>
                      <p className="flex items-center gap-2">
                        <Phone className="h-4 w-4" />
                        <a
                          href={`tel:${acceptedReferrals[work.id].client_phone}`}
                          className="text-blue-600 hover:underline"
                        >
                          {acceptedReferrals[work.id].client_phone}
                        </a>
                      </p>
                      {acceptedReferrals[work.id].client_email && (
                        <p className="flex items-center gap-2">
                          <Mail className="h-4 w-4" />
                          <a
                            href={`mailto:${acceptedReferrals[work.id].client_email}`}
                            className="text-blue-600 hover:underline"
                          >
                            {acceptedReferrals[work.id].client_email}
                          </a>
                        </p>
                      )}
                      {acceptedReferrals[work.id].notes && (
                        <p className="mt-2 flex items-start gap-2">
                          <FileText className="mt-0.5 h-4 w-4" />
                          <span className="text-muted-foreground">
                            {acceptedReferrals[work.id].notes}
                          </span>
                        </p>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="flex gap-2">
                    <Button
                      onClick={() => handleAcceptWork(work.id)}
                      disabled={processingReferralId === work.id}
                      className="flex-1 bg-green-600 hover:bg-green-700"
                    >
                      {processingReferralId === work.id ? (
                        'Processing...'
                      ) : (
                        <>
                          <Check className="mr-2 h-4 w-4" />
                          Accept
                        </>
                      )}
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => handleDeclineWork(work.id)}
                      disabled={processingReferralId === work.id}
                      className="border-red-300 text-red-600 hover:bg-red-50"
                    >
                      <X className="mr-2 h-4 w-4" />
                      Decline
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Accepted Work History */}
      {acceptedIncomingWork.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CheckCircle className="h-5 w-5 text-green-600" />
              Work From Sasquatch
            </CardTitle>
            <CardDescription>
              Jobs referred to you by Sasquatch Carpet Cleaning
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {acceptedIncomingWork.map((work) => (
                <div
                  key={work.id}
                  className="flex items-center justify-between rounded-lg border p-3"
                >
                  <div>
                    <p className="font-medium">{work.description}</p>
                    <p className="text-muted-foreground text-sm">
                      {work.client_name} • {work.client_phone}
                    </p>
                  </div>
                  <div className="text-right">
                    <Badge
                      variant={
                        work.status === 'completed' ? 'default' : 'secondary'
                      }
                    >
                      {work.status}
                    </Badge>
                    {work.referral_fee > 0 && (
                      <p className="text-muted-foreground mt-1 text-xs">
                        Fee: ${work.referral_fee.toFixed(2)}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Stats Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-900/30">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-green-800 dark:text-green-200">
              Credit Balance
            </CardTitle>
            <DollarSign className="h-4 w-4 text-green-600" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-green-700 dark:text-green-300">
              ${stats.creditBalance.toFixed(2)}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Total Referrals
            </CardTitle>
            <Users className="text-muted-foreground h-4 w-4" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{stats.totalReferrals}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Converted</CardTitle>
            <CheckCircle className="text-muted-foreground h-4 w-4" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{stats.convertedReferrals}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Pending / Booked
            </CardTitle>
            <Clock className="text-muted-foreground h-4 w-4" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">
              {stats.pendingReferrals} / {stats.bookedReferrals}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Main Content Grid */}
      <div className="grid gap-8 lg:grid-cols-2">
        {/* Submit Referral Form */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Send className="h-5 w-5" />
              Submit a Referral
            </CardTitle>
            <CardDescription>
              Send us a lead and earn ${partner.backlink_verified ? '25' : '20'}{' '}
              when they book!
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmitReferral} className="space-y-4">
              <div className="grid gap-2">
                <Label htmlFor="clientName">Client Name *</Label>
                <Input
                  id="clientName"
                  value={clientName}
                  onChange={(e) => setClientName(e.target.value)}
                  placeholder="Jane Doe"
                  required
                />
              </div>

              <div className="grid gap-2">
                <Label htmlFor="clientPhone">Client Phone *</Label>
                <Input
                  id="clientPhone"
                  type="tel"
                  value={clientPhone}
                  onChange={(e) => setClientPhone(e.target.value)}
                  placeholder="(555) 123-4567"
                  required
                />
              </div>

              <div className="grid gap-2">
                <Label htmlFor="notes">Notes (Optional)</Label>
                <Textarea
                  id="notes"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Any details about the client or property..."
                  rows={3}
                />
              </div>

              {submitError && (
                <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-600">
                  {submitError}
                </div>
              )}

              {submitSuccess && (
                <div className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-600">
                  Referral submitted successfully!
                </div>
              )}

              <div className="flex flex-col gap-2 sm:flex-row">
                <Button
                  type="submit"
                  disabled={isSubmitting}
                  className="flex-1"
                >
                  {isSubmitting ? 'Submitting...' : 'Submit Referral'}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={isSubmitting}
                  onClick={handleBookForClient}
                  className="flex-1"
                >
                  <ExternalLink className="mr-2 h-4 w-4" />
                  Book for Client
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>

        {/* Cash In Section */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Gift className="h-5 w-5" />
              Cash In Your Credits
            </CardTitle>
            <CardDescription>
              Use your credits for a free cleaning at your own home!
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-lg bg-gradient-to-r from-green-100 to-emerald-100 p-6 text-center dark:from-green-900/30 dark:to-emerald-900/30">
              <p className="text-muted-foreground text-sm">Your Balance</p>
              <p className="text-4xl font-bold text-green-700 dark:text-green-300">
                ${stats.creditBalance.toFixed(2)}
              </p>
            </div>

            <Button
              className="w-full"
              size="lg"
              disabled={stats.creditBalance <= 0}
              onClick={() => {
                // TODO: Add actual HousecallPro booking URL
                window.open('https://housecallpro.com', '_blank')
              }}
            >
              <Gift className="mr-2 h-5 w-5" />
              Book My Cleaning
            </Button>

            {stats.creditBalance <= 0 && (
              <p className="text-muted-foreground text-center text-sm">
                Submit referrals to earn credits!
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Referrals Table */}
      <Card>
        <CardHeader>
          <CardTitle>My Referrals</CardTitle>
          <CardDescription>Track the status of your referrals</CardDescription>
        </CardHeader>
        <CardContent>
          {referrals.length === 0 ? (
            <div className="text-muted-foreground py-8 text-center">
              <Users className="mx-auto mb-2 h-12 w-12 opacity-50" />
              <p>No referrals yet</p>
              <p className="text-sm">Submit your first referral above!</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="text-muted-foreground border-b text-left text-sm">
                    <th className="pb-3 font-medium">Client</th>
                    <th className="pb-3 font-medium">Phone</th>
                    <th className="pb-3 font-medium">Status</th>
                    <th className="pb-3 font-medium">Credit</th>
                    <th className="pb-3 font-medium">Date</th>
                  </tr>
                </thead>
                <tbody>
                  {referrals.map((referral) => (
                    <tr key={referral.id} className="border-b">
                      <td className="py-3 font-medium">
                        {referral.client_name}
                      </td>
                      <td className="text-muted-foreground py-3">
                        {referral.client_phone}
                      </td>
                      <td className="py-3">
                        {getStatusBadge(referral.status)}
                      </td>
                      <td className="py-3">
                        ${referral.credit_amount.toFixed(2)}
                      </td>
                      <td className="text-muted-foreground py-3">
                        {formatDate(referral.created_at)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Promote Us Section (Placeholder) */}
      <Card>
        <CardHeader>
          <CardTitle>Promote Us</CardTitle>
          <CardDescription>
            Add our badge to your website and earn $25 per referral!
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="bg-muted rounded-lg p-6 text-center">
            <p className="text-muted-foreground">
              🚧 Coming soon in Phase 2! 🚧
            </p>
            <p className="text-muted-foreground mt-2 text-sm">
              We&apos;ll provide an embed code you can add to your website.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
