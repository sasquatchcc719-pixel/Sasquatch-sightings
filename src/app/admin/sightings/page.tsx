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
  Loader2,
  Map,
  Camera,
  Trash2,
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
  share_verified: boolean | null
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
  const [filter, setFilter] = useState<
    'all' | 'eligible' | 'coupon-only' | 'shared'
  >('all')
  const [updatingId, setUpdatingId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

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
      filtered = filtered.filter((s) => s.contest_eligible)
    } else if (filter === 'coupon-only') {
      filtered = filtered.filter((s) => !s.contest_eligible)
    } else if (filter === 'shared') {
      filtered = filtered.filter((s) => s.share_verified)
    }

    // Apply search
    if (searchTerm) {
      const term = searchTerm.toLowerCase()
      filtered = filtered.filter(
        (s) =>
          s.full_name.toLowerCase().includes(term) ||
          s.phone_number.toLowerCase().includes(term) ||
          s.email.toLowerCase().includes(term) ||
          s.coupon_code.toLowerCase().includes(term),
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
        setSightings((prev) =>
          prev.map((s) =>
            s.id === id ? { ...s, coupon_redeemed: !currentStatus } : s,
          ),
        )
      }
    } catch (error) {
      console.error('Error updating coupon status:', error)
    } finally {
      setUpdatingId(null)
    }
  }

  // Handle delete sighting
  const handleDelete = async (id: string, name: string) => {
    if (
      !confirm(
        `Are you sure you want to delete the entry from ${name}? This cannot be undone.`,
      )
    ) {
      return
    }

    setDeletingId(id)
    try {
      const response = await fetch(`/api/sightings/${id}/delete`, {
        method: 'DELETE',
      })

      if (response.ok) {
        // Remove from local state
        setSightings((prev) => prev.filter((s) => s.id !== id))
      } else {
        const data = await response.json()
        alert(`Failed to delete entry: ${data.error || 'Unknown error'}`)
      }
    } catch (error) {
      console.error('Error deleting sighting:', error)
      alert('Failed to delete entry. Please try again.')
    } finally {
      setDeletingId(null)
    }
  }

  // Export to CSV
  const handleExportCSV = () => {
    const csvContent = [
      [
        'Full Name',
        'Phone Number',
        'Email',
        'Zip Code',
        'Coupon Code',
        'Contest Eligible',
        'Shared',
        'Coupon Redeemed',
        'Date Submitted',
      ],
      ...filteredSightings.map((s) => [
        s.full_name,
        s.phone_number,
        s.email,
        s.zip_code || '',
        s.coupon_code,
        s.contest_eligible ? 'Yes' : 'No',
        s.share_verified ? 'Yes' : 'No',
        s.coupon_redeemed ? 'Yes' : 'No',
        new Date(s.created_at).toLocaleDateString(),
      ]),
    ]
      .map((row) => row.join(','))
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
    <div className="w-full space-y-4 sm:space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold sm:text-3xl">
            <Trophy className="h-6 w-6 sm:h-8 sm:w-8" />
            Contest Entries
          </h1>
          <p className="text-muted-foreground text-sm">
            Manage Sasquatch sighting submissions
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            asChild
            variant="default"
            size="sm"
            className="sm:size-default"
          >
            <Link href="/">
              <Map className="mr-1 h-4 w-4 sm:mr-2" />
              <span className="hidden sm:inline">View </span>Map
            </Link>
          </Button>
          <Button
            onClick={handleExportCSV}
            variant="outline"
            size="sm"
            className="sm:size-default"
          >
            <Download className="mr-1 h-4 w-4 sm:mr-2" />
            <span className="hidden sm:inline">Export </span>CSV
          </Button>
          <Button
            asChild
            variant="outline"
            size="sm"
            className="sm:size-default"
          >
            <Link href="/sightings" target="_blank">
              <Camera className="mr-1 h-4 w-4 sm:mr-2" />
              <span className="hidden sm:inline">Test </span>Contest
            </Link>
          </Button>
        </div>
      </div>

      {/* Filters and Search */}
      <div className="space-y-3">
        {/* Search */}
        <div className="relative">
          <Search className="text-muted-foreground absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
          <Input
            placeholder="Search by name, phone, email, or coupon..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-9"
          />
        </div>

        {/* Filter Buttons */}
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant={filter === 'all' ? 'default' : 'outline'}
            onClick={() => setFilter('all')}
            className="text-xs sm:text-sm"
          >
            All ({sightings.length})
          </Button>
          <Button
            size="sm"
            variant={filter === 'eligible' ? 'default' : 'outline'}
            onClick={() => setFilter('eligible')}
            className="text-xs sm:text-sm"
          >
            <span className="hidden sm:inline">Contest </span>Eligible (
            {sightings.filter((s) => s.contest_eligible).length})
          </Button>
          <Button
            size="sm"
            variant={filter === 'coupon-only' ? 'default' : 'outline'}
            onClick={() => setFilter('coupon-only')}
            className="text-xs sm:text-sm"
          >
            Coupon Only ({sightings.filter((s) => !s.contest_eligible).length})
          </Button>
          <Button
            size="sm"
            variant={filter === 'shared' ? 'default' : 'outline'}
            onClick={() => setFilter('shared')}
            className={`text-xs sm:text-sm ${filter === 'shared' ? 'bg-blue-600 hover:bg-blue-700' : ''}`}
          >
            ✓ Shared ({sightings.filter((s) => s.share_verified).length})
          </Button>
        </div>
      </div>

      {/* Results Count */}
      <p className="text-muted-foreground text-sm">
        Showing {filteredSightings.length}{' '}
        {filteredSightings.length === 1 ? 'entry' : 'entries'}
      </p>

      {/* Sightings List */}
      <div className="space-y-3">
        {filteredSightings.length === 0 ? (
          <Card className="text-muted-foreground p-8 text-center">
            No entries found
          </Card>
        ) : (
          filteredSightings.map((sighting) => (
            <Card key={sighting.id} className="overflow-hidden">
              <div className="flex gap-3 p-3 sm:gap-4 sm:p-4">
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
                      className="h-24 w-24 rounded-md object-cover transition-opacity hover:opacity-80 sm:h-32 sm:w-32"
                    />
                  </a>
                </div>

                {/* Details */}
                <div className="min-w-0 flex-1 space-y-2 sm:space-y-3">
                  {/* Top Row: Name & Badges */}
                  <div className="flex flex-wrap items-start justify-between gap-1">
                    <span className="font-semibold sm:text-lg">
                      {sighting.full_name}
                    </span>
                    <div className="flex flex-wrap gap-1">
                      <Badge
                        variant={
                          sighting.contest_eligible ? 'default' : 'secondary'
                        }
                        className={`text-xs ${sighting.contest_eligible ? 'bg-green-600' : ''}`}
                      >
                        {sighting.contest_eligible
                          ? '✓ Eligible'
                          : 'Coupon Only'}
                      </Badge>
                      {sighting.share_verified && (
                        <Badge
                          variant="outline"
                          className="border-blue-500 text-xs text-blue-600 dark:text-blue-400"
                        >
                          ✓ Shared
                        </Badge>
                      )}
                    </div>
                  </div>

                  {/* Contact Details */}
                  <div className="space-y-0.5 text-xs sm:text-sm">
                    <div className="flex items-center gap-1">
                      <Mail className="text-muted-foreground h-3 w-3" />
                      <span className="truncate">{sighting.email}</span>
                    </div>
                    <div className="text-muted-foreground">
                      📱 {sighting.phone_number}
                    </div>
                    {sighting.zip_code && (
                      <div className="text-muted-foreground">
                        📍 Zip: {sighting.zip_code}
                      </div>
                    )}
                  </div>

                  {/* Coupon Code */}
                  <p className="text-muted-foreground font-mono text-xs">
                    {sighting.coupon_code}
                  </p>

                  {/* View on Map Link */}
                  {sighting.gps_lat && sighting.gps_lng && (
                    <Link
                      href="/"
                      className="flex items-center gap-1 text-xs text-green-600 hover:underline sm:text-sm dark:text-green-400"
                    >
                      <MapPin className="h-3 w-3" />
                      View on Map
                    </Link>
                  )}

                  {/* Location & Date */}
                  <div className="text-muted-foreground flex flex-wrap gap-2 text-xs sm:gap-4 sm:text-sm">
                    {sighting.gps_lat && sighting.gps_lng && (
                      <div className="flex items-center gap-1">
                        <MapPin className="h-3 w-3" />
                        <span>
                          {sighting.gps_lat.toFixed(4)},{' '}
                          {sighting.gps_lng.toFixed(4)}
                        </span>
                      </div>
                    )}
                    <div className="flex items-center gap-1">
                      <Calendar className="h-3 w-3" />
                      <span>
                        {new Date(sighting.created_at).toLocaleDateString(
                          'en-US',
                          {
                            month: 'short',
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                          },
                        )}
                      </span>
                    </div>
                  </div>

                  {/* Coupon Redeemed Checkbox & Delete Button */}
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="bg-muted/30 flex items-center space-x-2 rounded-md border px-2 py-1.5">
                      <Checkbox
                        id={`redeemed-${sighting.id}`}
                        checked={sighting.coupon_redeemed}
                        onCheckedChange={() =>
                          handleToggleRedeemed(
                            sighting.id,
                            sighting.coupon_redeemed,
                          )
                        }
                        disabled={updatingId === sighting.id}
                        className="h-4 w-4"
                      />
                      <Label
                        htmlFor={`redeemed-${sighting.id}`}
                        className="cursor-pointer text-xs font-medium sm:text-sm"
                      >
                        {updatingId === sighting.id ? (
                          <span className="flex items-center gap-1">
                            <Loader2 className="h-3 w-3 animate-spin" />
                            ...
                          </span>
                        ) : (
                          'Coupon Redeemed'
                        )}
                      </Label>
                    </div>
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() =>
                        handleDelete(sighting.id, sighting.full_name)
                      }
                      disabled={deletingId === sighting.id}
                      className="h-8 px-2 text-xs sm:px-3 sm:text-sm"
                    >
                      {deletingId === sighting.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <>
                          <Trash2 className="mr-1 h-3 w-3 sm:mr-2 sm:h-4 sm:w-4" />
                          Delete
                        </>
                      )}
                    </Button>
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
