'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Edit, CheckCircle2, Trash2, Loader2 } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

type Job = {
  id: string
  slug?: string
  image_url: string
  city: string
  neighborhood: string | null
  raw_voice_input?: string | null
  ai_description: string | null
  created_at?: string
  published_at?: string
  services: {
    name: string
  } | {
    name: string
  }[]
}

type DraftJobsListProps = {
  initialJobs: Job[]
}

export function DraftJobsList({ initialJobs }: DraftJobsListProps) {
  const [deletingJobId, setDeletingJobId] = useState<string | null>(null)
  const router = useRouter()

  const handleDelete = async (jobId: string, jobTitle: string) => {
    // Confirm deletion
    const confirmed = window.confirm(
      `Are you sure you want to delete this job?\n\n"${jobTitle}"\n\nThis will permanently delete the job and its image from storage. This action cannot be undone.`
    )

    if (!confirmed) {
      return
    }

    setDeletingJobId(jobId)

    try {
      const response = await fetch(`/api/jobs/${jobId}/delete`, {
        method: 'DELETE',
      })

      const result = await response.json()

      if (!response.ok) {
        throw new Error(result.error || 'Failed to delete job')
      }

      // Refresh the page to show updated list
      router.refresh()
    } catch (error) {
      console.error('Delete error:', error)
      alert(
        error instanceof Error
          ? error.message
          : 'Failed to delete job. Please try again.'
      )
    } finally {
      setDeletingJobId(null)
    }
  }

  if (initialJobs.length === 0) {
    return (
      <div className="text-center text-muted-foreground">
        No published jobs yet. Upload your first job above!
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {initialJobs.map((job) => (
        <Card key={job.id} className="overflow-hidden">
          <div className="flex flex-col gap-4 p-4 md:flex-row">
            {/* Image Thumbnail */}
            <div className="shrink-0">
              <img
                src={job.image_url}
                alt="Job"
                className="h-32 w-32 rounded-md object-cover"
              />
            </div>

            {/* Job Info */}
            <div className="flex-1 space-y-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h3 className="font-semibold">
                    {Array.isArray(job.services) ? job.services[0]?.name : job.services.name}
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    {job.neighborhood ? `${job.neighborhood}, ` : ''}
                    {job.city}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Published{' '}
                    {new Date(job.published_at || job.created_at || '').toLocaleDateString('en-US', {
                      year: 'numeric',
                      month: 'short',
                      day: 'numeric',
                    })}
                  </p>
                </div>
                <Badge variant="default" className="bg-green-600">
                  <CheckCircle2 className="mr-1 h-3 w-3" />
                  Published
                </Badge>
              </div>

              {/* Description Preview */}
              {job.ai_description && (
                <div className="rounded-md bg-muted p-3">
                  <p className="text-xs font-medium text-muted-foreground">
                    Description:
                  </p>
                  <p className="mt-1 line-clamp-2 text-sm">
                    {job.ai_description}
                  </p>
                </div>
              )}

              {/* Action Buttons */}
              <div className="flex flex-wrap gap-2">
                <Link href={`/admin/jobs/${job.id}`} className="flex-1 min-w-[140px]">
                  <Button size="sm" variant="outline" className="w-full">
                    <Edit className="mr-2 h-4 w-4" />
                    Edit Job
                  </Button>
                </Link>
                {job.slug && (
                  <Link href={`/work/${encodeURIComponent(job.city)}/${job.slug}`} className="flex-1 min-w-[140px]">
                    <Button size="sm" className="w-full">
                      View Public Page
                    </Button>
                  </Link>
                )}
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() =>
                    handleDelete(
                      job.id,
                      `${Array.isArray(job.services) ? job.services[0]?.name : job.services.name} - ${job.city}`
                    )
                  }
                  disabled={deletingJobId === job.id}
                  className="min-w-[100px]"
                >
                  {deletingJobId === job.id ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Deleting...
                    </>
                  ) : (
                    <>
                      <Trash2 className="mr-2 h-4 w-4" />
                      Delete
                    </>
                  )}
                </Button>
              </div>
            </div>
          </div>
        </Card>
      ))}
    </div>
  )
}
