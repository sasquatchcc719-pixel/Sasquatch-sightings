'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { 
  Trophy, 
  Download, 
  Search, 
  MapPin, 
  Mail, 
  Calendar,
  ExternalLink,
  Loader2,
  Map
} from 'lucide-react'
import Link from 'next/link'

type Sighting = {
  id: string
  image_url: string
  full_name: string
  phone_number: string
  email: string
  zip_code: string | null
  coupon_code: string
  contest_eligible: boolean
  coupon_redeemed: boolean
  social_platform: string | null
  social_link: string | null
  gps_lat: number | null
  gps_lng: number | null
  created_at: string
}

export default function SightingsAdminPage() {
  const [sightings, setSightings] = useState<Sighting[]>([])
  const [filteredSightings, setFilteredSightings] = useState<Sighting[]>([])
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')
  const [filter, setFilter] = useState<'all' | 'eligible' | 'coupon-only'>('all')
  const [updatingId, setUpdatingId] = useState<string | null>(null)

  // Fetch sightings
  useEffect(() => {
    async function fetchSightings() {
      const supabase = createClient()
      const { data, error } = await supabase
        .from('sightings')
        .select('*')
        .order('created_at', { ascending: false })

      if (error) {
        console.error('Error fetching sightings:', error)
      } else {
        setSightings(data || [])
        setFilteredSightings(data || [])
      }
      setLoading(false)
    }

    fetchSightings()
  }, [])

  // Apply filters and search
  useEffect(() => {
    let filtered = sightings

    // Apply filter
    if (filter === 'eligible') {
      filtered = filtered.filter(s => s.contest_eligible)
    } else if (filter === 'coupon-only') {
      filtered = filtered.filter(s => !s.contest_eligible)
    }

    // Apply search
    if (searchTerm) {
      const term = searchTerm.toLowerCase()
      filtered = filtered.filter(s => 
        s.full_name.toLowerCase().includes(term) ||
        s.phone_number.toLowerCase().includes(term) ||
        s.email.toLowerCase().includes(term) ||
        s.coupon_code.toLowerCase().includes(term)
      )
    }

    setFilteredSightings(filtered)
  }, [sightings, filter, searchTerm])

  // Handle coupon redeemed toggle
  const handleToggleRedeemed = async (id: string, currentStatus: boolean) => {
    setUpdatingId(id)
    try {
      const response = await fetch(`/api/sightings/${id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ coupon_redeemed: !currentStatus }),
      })

      if (response.ok) {
        // Update local state
        setSightings(prev =>
          prev.map(s =>
            s.id === id ? { ...s, coupon_redeemed: !currentStatus } : s
          )
        )
      }
    } catch (error) {
      console.error('Error updating coupon status:', error)
    } finally {
      setUpdatingId(null)
    }
  }

  // Export to CSV
  const handleExportCSV = () => {
    const csvContent = [
      ['Full Name', 'Phone Number', 'Email', 'Zip Code', 'Coupon Code', 'Contest Eligible', 'Coupon Redeemed', 'Date Submitted'],
      ...filteredSightings.map(s => [
        s.full_name,
        s.phone_number,
        s.email,
        s.zip_code || '',
        s.coupon_code,
        s.contest_eligible ? 'Yes' : 'No',
        s.coupon_redeemed ? 'Yes' : 'No',
        new Date(s.created_at).toLocaleDateString(),
      ])
    ]
      .map(row => row.join(','))
      .join('\n')

    const blob = new Blob([csvContent], { type: 'text/csv' })
    const url = window.URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `sightings-${new Date().toISOString().split('T')[0]}.csv`
    a.click()
    window.URL.revokeObjectURL(url)
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    )
  }

  return (
    <div className="w-full space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-3xl font-bold">
            <Trophy className="h-8 w-8" />
            Contest Entries
          </h1>
          <p className="text-muted-foreground">
            Manage Sasquatch sighting submissions
          </p>
        </div>
        <div className="flex gap-2">
          <Button asChild variant="default">
            <Link href="/">
              <Map className="mr-2 h-4 w-4" />
              View Map
            </Link>
          </Button>
          <Button onClick={handleExportCSV} variant="outline">
            <Download className="mr-2 h-4 w-4" />
            Export CSV
          </Button>
        </div>
      </div>

      {/* Filters and Search */}
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        {/* Search */}
        <div className="relative flex-1 md:max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search by name, phone, email, or coupon..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-9"
          />
        </div>

        {/* Filter Buttons */}
        <div className="flex gap-2">
          <Button
            size="sm"
            variant={filter === 'all' ? 'default' : 'outline'}
            onClick={() => setFilter('all')}
          >
            All ({sightings.length})
          </Button>
          <Button
            size="sm"
            variant={filter === 'eligible' ? 'default' : 'outline'}
            onClick={() => setFilter('eligible')}
          >
            Contest Eligible ({sightings.filter(s => s.contest_eligible).length})
          </Button>
          <Button
            size="sm"
            variant={filter === 'coupon-only' ? 'default' : 'outline'}
            onClick={() => setFilter('coupon-only')}
          >
            Coupon Only ({sightings.filter(s => !s.contest_eligible).length})
          </Button>
        </div>
      </div>

      {/* Results Count */}
      <p className="text-sm text-muted-foreground">
        Showing {filteredSightings.length} {filteredSightings.length === 1 ? 'entry' : 'entries'}
      </p>

      {/* Sightings List */}
      <div className="space-y-4">
        {filteredSightings.length === 0 ? (
          <Card className="p-8 text-center text-muted-foreground">
            No entries found
          </Card>
        ) : (
          filteredSightings.map((sighting) => (
            <Card key={sighting.id} className="overflow-hidden">
              <div className="flex flex-col gap-4 p-4 md:flex-row">
                {/* Image Thumbnail */}
                <div className="shrink-0">
                  <a
                    href={sighting.image_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block"
                  >
                    <img
                      src={sighting.image_url}
                      alt="Sighting"
                      className="h-32 w-32 rounded-md object-cover transition-opacity hover:opacity-80"
                    />
                  </a>
                </div>

                {/* Details */}
                <div className="flex-1 space-y-3">
                  {/* Top Row: Contact Info & Status */}
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="space-y-2">
                      {/* Full Name */}
                      <div>
                        <span className="font-semibold text-lg">{sighting.full_name}</span>
                      </div>
                      
                      {/* Contact Details */}
                      <div className="space-y-1 text-sm">
                        <div className="flex items-center gap-2">
                          <Mail className="h-4 w-4 text-muted-foreground" />
                          <span>{sighting.email}</span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">📱 {sighting.phone_number}</span>
                        </div>
                        {sighting.zip_code && (
                          <div>
                            <span className="text-muted-foreground">📍 Zip: {sighting.zip_code}</span>
                          </div>
                        )}
                      </div>
                      
                      {/* Coupon Code */}
                      <p className="text-sm font-mono text-muted-foreground">
                        {sighting.coupon_code}
                      </p>
                    </div>
                    <Badge
                      variant={sighting.contest_eligible ? 'default' : 'secondary'}
                      className={sighting.contest_eligible ? 'bg-green-600' : ''}
                    >
                      {sighting.contest_eligible ? '✓ Eligible' : 'Coupon Only'}
                    </Badge>
                  </div>

                  {/* Social Media Link */}
                  {sighting.social_platform && sighting.social_link && (
                    <div className="rounded-md bg-blue-50 p-2 dark:bg-blue-950/30">
                      <p className="text-xs font-semibold text-blue-800 dark:text-blue-200">
                        Shared on {sighting.social_platform}:
                      </p>
                      <a
                        href={sighting.social_link}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 text-sm text-blue-600 hover:underline dark:text-blue-400"
                      >
                        View Post
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    </div>
                  )}

                  {/* View on Map Link */}
                  {sighting.gps_lat && sighting.gps_lng && (
                    <div>
                      <Link
                        href="/"
                        className="flex items-center gap-1 text-sm text-green-600 hover:underline dark:text-green-400"
                      >
                        <MapPin className="h-3 w-3" />
                        View on Map
                      </Link>
                    </div>
                  )}

                  {/* Location & Date */}
                  <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
                    {sighting.gps_lat && sighting.gps_lng && (
                      <div className="flex items-center gap-1">
                        <MapPin className="h-3 w-3" />
                        <span>
                          {sighting.gps_lat.toFixed(4)}, {sighting.gps_lng.toFixed(4)}
                        </span>
                      </div>
                    )}
                    <div className="flex items-center gap-1">
                      <Calendar className="h-3 w-3" />
                      <span>
                        {new Date(sighting.created_at).toLocaleDateString('en-US', {
                          year: 'numeric',
                          month: 'short',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                    </div>
                  </div>

                  {/* Coupon Redeemed Checkbox */}
                  <div className="flex items-center space-x-2 rounded-md border bg-muted/30 p-2">
                    <Checkbox
                      id={`redeemed-${sighting.id}`}
                      checked={sighting.coupon_redeemed}
                      onCheckedChange={() =>
                        handleToggleRedeemed(sighting.id, sighting.coupon_redeemed)
                      }
                      disabled={updatingId === sighting.id}
                    />
                    <Label
                      htmlFor={`redeemed-${sighting.id}`}
                      className="cursor-pointer text-sm font-medium"
                    >
                      {updatingId === sighting.id ? (
                        <span className="flex items-center gap-2">
                          <Loader2 className="h-3 w-3 animate-spin" />
                          Updating...
                        </span>
                      ) : (
                        'Coupon Redeemed'
                      )}
                    </Label>
                  </div>
                </div>
              </div>
            </Card>
          ))
        )}
      </div>
    </div>
  )
}
