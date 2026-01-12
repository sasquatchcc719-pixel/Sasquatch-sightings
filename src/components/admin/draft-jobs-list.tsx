'use client'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Edit, CheckCircle2 } from 'lucide-react'
import Link from 'next/link'

type DraftJob = {
  id: string
  image_url: string
  city: string
  neighborhood: string | null
  raw_voice_input: string | null
  ai_description: string | null
  created_at: string
  services: {
    name: string
  }
}

type DraftJobsListProps = {
  initialJobs: DraftJob[]
}

export function DraftJobsList({ initialJobs }: DraftJobsListProps) {
  if (initialJobs.length === 0) {
    return (
      <div className="text-center text-muted-foreground">
        No draft jobs yet. Upload a photo above to get started!
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
                  <h3 className="font-semibold">{job.services.name}</h3>
                  <p className="text-sm text-muted-foreground">
                    {job.neighborhood ? `${job.neighborhood}, ` : ''}
                    {job.city}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {new Date(job.created_at).toLocaleDateString('en-US', {
                      year: 'numeric',
                      month: 'short',
                      day: 'numeric',
                    })}
                  </p>
                </div>
                <Badge variant="outline">Draft</Badge>
              </div>

              {/* Voice Note Preview */}
              {job.raw_voice_input && (
                <div className="rounded-md bg-muted p-3">
                  <p className="text-xs font-medium text-muted-foreground">
                    Field Notes:
                  </p>
                  <p className="mt-1 line-clamp-2 text-sm">
                    {job.raw_voice_input}
                  </p>
                </div>
              )}

              {/* Status Indicator */}
              <div className="flex items-center gap-2">
                {job.ai_description ? (
                  <div className="flex items-center gap-1 text-sm text-green-600 dark:text-green-400">
                    <CheckCircle2 className="h-4 w-4" />
                    Has description
                  </div>
                ) : (
                  <div className="text-sm text-muted-foreground">
                    No description yet
                  </div>
                )}
              </div>

              {/* Edit Button */}
              <Link href={`/protected/jobs/${job.id}`}>
                <Button size="sm" className="w-full">
                  <Edit className="mr-2 h-4 w-4" />
                  Edit & Publish
                </Button>
              </Link>
            </div>
          </div>
        </Card>
      ))}
    </div>
  )
}
