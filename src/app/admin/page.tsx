import { createClient } from '@/supabase/server'
import { UploadForm } from '@/components/admin/upload-form'
import { DraftJobsList } from '@/components/admin/draft-jobs-list'
import { Button } from '@/components/ui/button'
import { Briefcase, FileText, Map, Camera, Image } from 'lucide-react'
import Link from 'next/link'

export default async function AdminPage() {
  const supabase = await createClient()

  // Fetch published jobs with service details
  const { data: publishedJobs } = await supabase
    .from('jobs')
    .select(
      `
      id,
      slug,
      image_url,
      city,
      neighborhood,
      ai_description,
      published_at,
      services (
        name
      )
    `
    )
    .eq('status', 'published')
    .order('published_at', { ascending: false })

  return (
    <div className="flex w-full flex-1 flex-col gap-12">
      {/* Upload Section */}
      <div className="space-y-8">
        <div className="space-y-4">
          <h1 className="flex items-center gap-2 text-3xl font-bold">
            <Briefcase className="h-8 w-8" />
            Publish New Job
          </h1>
          <p className="text-muted-foreground">
            Upload a photo and add a description to publish a job directly to the map
          </p>
          
          {/* Quick Actions */}
          <div className="flex gap-2 pt-2">
            <Button asChild variant="outline" size="sm">
              <Link href="/admin/tools/combine">
                <Image className="mr-2 h-4 w-4" />
                Before/After Tool
              </Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href="/sightings" target="_blank">
                <Camera className="mr-2 h-4 w-4" />
                Test Contest Page
              </Link>
            </Button>
          </div>
        </div>

        <div className="mx-auto w-full max-w-2xl">
          <UploadForm />
        </div>
      </div>

      {/* Published Jobs Section */}
      <div className="space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-2">
            <h2 className="flex items-center gap-2 text-2xl font-bold">
              <FileText className="h-7 w-7" />
              Published Jobs
            </h2>
            <p className="text-sm text-muted-foreground">
              View and edit your published jobs
            </p>
          </div>
          <Button asChild variant="default">
            <Link href="/">
              <Map className="mr-2 h-4 w-4" />
              View Map
            </Link>
          </Button>
        </div>

        <DraftJobsList initialJobs={publishedJobs || []} />
      </div>
    </div>
  )
}
