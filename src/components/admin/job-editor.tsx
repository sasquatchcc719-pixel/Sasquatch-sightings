'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Loader2, Save, Send, MapPin, Sparkles, DollarSign, Clock } from 'lucide-react'

type Job = {
  id: string
  image_url: string
  city: string
  neighborhood: string | null
  gps_lat: number | null
  gps_lng: number | null
  raw_voice_input: string | null
  ai_description: string | null
  invoice_amount: number | null
  hours_worked: number | null
  status: string
  created_at: string
  services: {
    name: string
  }[]
}

type JobEditorProps = {
  job: Job
}

export function JobEditor({ job }: JobEditorProps) {
  const router = useRouter()
  const [description, setDescription] = useState(job.ai_description || '')
  const [invoiceAmount, setInvoiceAmount] = useState(job.invoice_amount?.toString() || '')
  const [hoursWorked, setHoursWorked] = useState(job.hours_worked?.toString() || '')
  const [isSaving, setIsSaving] = useState(false)
  const [isPublishing, setIsPublishing] = useState(false)
  const [isGenerating, setIsGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)

  const handleGenerateDescription = async () => {
    setIsGenerating(true)
    setError(null)
    setSuccessMessage(null)

    try {
      const response = await fetch('/api/generate-description', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          serviceType: job.services[0]?.name,
          neighborhood: job.neighborhood,
          city: job.city,
          notes: job.raw_voice_input,
        }),
      })

      const result = await response.json()

      if (!response.ok) {
        throw new Error(result.error || 'Failed to generate description')
      }

      setDescription(result.description)
      setSuccessMessage('Description generated! Edit if needed, then save.')
      setTimeout(() => setSuccessMessage(null), 5000)
    } catch (err) {
      console.error('Generate error:', err)
      setError(err instanceof Error ? err.message : 'Failed to generate description')
    } finally {
      setIsGenerating(false)
    }
  }

  const handleSaveDescription = async () => {
    if (!description.trim()) {
      setError('Description cannot be empty')
      return
    }

    setIsSaving(true)
    setError(null)
    setSuccessMessage(null)

    try {
      const updateData: any = { ai_description: description }
      
      // Add invoice amount if provided
      if (invoiceAmount) {
        const amount = parseFloat(invoiceAmount)
        if (!isNaN(amount) && amount > 0) {
          updateData.invoice_amount = amount
        }
      }
      
      // Add hours worked if provided
      if (hoursWorked) {
        const hours = parseFloat(hoursWorked)
        if (!isNaN(hours) && hours > 0) {
          updateData.hours_worked = hours
        }
      }

      const response = await fetch(`/api/jobs/${job.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updateData),
      })

      const result = await response.json()

      if (!response.ok) {
        throw new Error(result.error || 'Failed to save description')
      }

      setSuccessMessage('Job details saved successfully!')
      setTimeout(() => setSuccessMessage(null), 3000)
    } catch (err) {
      console.error('Save error:', err)
      setError(err instanceof Error ? err.message : 'Failed to save')
    } finally {
      setIsSaving(false)
    }
  }

  const handlePublish = async () => {
    if (!description.trim()) {
      setError('Description is required before publishing')
      return
    }

    if (!confirm('Are you sure you want to publish this job? It will be publicly visible.')) {
      return
    }

    setIsPublishing(true)
    setError(null)
    setSuccessMessage(null)

    try {
      const updateData: any = {
        ai_description: description,
        status: 'published',
        published_at: new Date().toISOString(),
      }
      
      // Add invoice amount if provided
      if (invoiceAmount) {
        const amount = parseFloat(invoiceAmount)
        if (!isNaN(amount) && amount > 0) {
          updateData.invoice_amount = amount
        }
      }
      
      // Add hours worked if provided
      if (hoursWorked) {
        const hours = parseFloat(hoursWorked)
        if (!isNaN(hours) && hours > 0) {
          updateData.hours_worked = hours
        }
      }

      const response = await fetch(`/api/jobs/${job.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updateData),
      })

      const result = await response.json()

      if (!response.ok) {
        throw new Error(result.error || 'Failed to publish job')
      }

      // Redirect back to dashboard with success message
      router.push('/admin?published=true')
    } catch (err) {
      console.error('Publish error:', err)
      setError(err instanceof Error ? err.message : 'Failed to publish')
    } finally {
      setIsPublishing(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold">{job.services[0]?.name}</h1>
          <p className="text-muted-foreground">
            {job.neighborhood ? `${job.neighborhood}, ` : ''}
            {job.city}
          </p>
        </div>
        <Badge variant={job.status === 'published' ? 'default' : 'outline'}>
          {job.status}
        </Badge>
      </div>

      {/* Messages */}
      {error && (
        <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {successMessage && (
        <div className="rounded-md bg-green-500/10 p-3 text-sm text-green-700 dark:text-green-400">
          {successMessage}
        </div>
      )}

      <div className="grid gap-6 md:grid-cols-2">
        {/* Left Column - Image and Details */}
        <div className="space-y-6">
          {/* Job Image */}
          <Card className="overflow-hidden">
            <img
              src={job.image_url}
              alt="Job"
              className="h-auto w-full object-cover"
            />
          </Card>

          {/* Job Details */}
          <Card className="p-4 space-y-4">
            <div>
              <p className="text-sm font-medium text-muted-foreground">
                Service Type
              </p>
              <p className="text-lg">{job.services[0]?.name}</p>
            </div>

            <div>
              <p className="text-sm font-medium text-muted-foreground">
                Location
              </p>
              <p>
                {job.neighborhood ? `${job.neighborhood}, ` : ''}
                {job.city}
              </p>
            </div>

            {job.gps_lat && job.gps_lng && (
              <div>
                <p className="text-sm font-medium text-muted-foreground">
                  <MapPin className="mr-1 inline-block h-3 w-3" />
                  GPS Coordinates
                </p>
                <p className="font-mono text-sm">
                  {job.gps_lat.toFixed(6)}, {job.gps_lng.toFixed(6)}
                </p>
              </div>
            )}

            <div>
              <p className="text-sm font-medium text-muted-foreground">
                Created
              </p>
              <p className="text-sm">
                {new Date(job.created_at).toLocaleDateString('en-US', {
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </p>
            </div>
          </Card>

          {/* Voice Note */}
          {job.raw_voice_input && (
            <Card className="p-4">
              <p className="mb-2 text-sm font-medium text-muted-foreground">
                Field Notes
              </p>
              <p className="whitespace-pre-wrap text-sm leading-relaxed">
                {job.raw_voice_input}
              </p>
            </Card>
          )}
        </div>

        {/* Right Column - Description Editor */}
        <div className="space-y-6">
          <Card className="p-6">
            <div className="space-y-4">
              <div>
                <Label htmlFor="description">Job Description</Label>
                <p className="text-xs text-muted-foreground mb-2">
                  Generate with AI or write your own
                </p>
              </div>

              {/* AI Generate Button */}
              <Button
                type="button"
                onClick={handleGenerateDescription}
                disabled={isGenerating}
                variant="secondary"
                size="sm"
                className="w-full"
              >
                {isGenerating ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Generating with AI...
                  </>
                ) : (
                  <>
                    <Sparkles className="mr-2 h-4 w-4" />
                    Generate Description with AI
                  </>
                )}
              </Button>

              <Textarea
                id="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={12}
                placeholder="Click 'Generate with AI' or write your own..."
                className="resize-none"
              />

              <p className="text-xs text-muted-foreground">
                {description.length} characters
              </p>

              {/* Revenue Tracking Fields */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-4 border-t">
                <div className="space-y-2">
                  <Label htmlFor="invoiceAmount">
                    <DollarSign className="mr-1 inline-block h-4 w-4" />
                    Invoice Amount
                  </Label>
                  <Input
                    id="invoiceAmount"
                    type="number"
                    step="0.01"
                    min="0"
                    value={invoiceAmount}
                    onChange={(e) => setInvoiceAmount(e.target.value)}
                    placeholder="0.00"
                    className="font-mono"
                  />
                  <p className="text-xs text-muted-foreground">
                    Total revenue for this job
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="hoursWorked">
                    <Clock className="mr-1 inline-block h-4 w-4" />
                    Hours Worked
                  </Label>
                  <Input
                    id="hoursWorked"
                    type="number"
                    step="0.25"
                    min="0"
                    value={hoursWorked}
                    onChange={(e) => setHoursWorked(e.target.value)}
                    placeholder="0.0"
                    className="font-mono"
                  />
                  <p className="text-xs text-muted-foreground">
                    Time spent (e.g., 2.5 hours)
                  </p>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex flex-col gap-3">
                <Button
                  onClick={handleSaveDescription}
                  disabled={isSaving || !description.trim()}
                  size="lg"
                  variant="outline"
                  className="w-full"
                >
                  {isSaving ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    <>
                      <Save className="mr-2 h-4 w-4" />
                      Save Description
                    </>
                  )}
                </Button>

                <Button
                  onClick={handlePublish}
                  disabled={
                    isPublishing ||
                    !description.trim() ||
                    job.status === 'published'
                  }
                  size="lg"
                  className="w-full"
                >
                  {isPublishing ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Publishing...
                    </>
                  ) : (
                    <>
                      <Send className="mr-2 h-4 w-4" />
                      {job.status === 'published'
                        ? 'Already Published'
                        : 'Publish Job'}
                    </>
                  )}
                </Button>

                {job.status === 'published' && (
                  <p className="text-xs text-center text-muted-foreground">
                    This job is already published
                  </p>
                )}
              </div>
            </div>
          </Card>
        </div>
      </div>
    </div>
  )
}
