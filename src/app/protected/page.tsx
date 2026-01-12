import { redirect } from 'next/navigation'
import { createClient } from '@/supabase/server'
import { UploadForm } from '@/components/admin/upload-form'
import { DraftJobsList } from '@/components/admin/draft-jobs-list'
import { Briefcase, FileText } from 'lucide-react'

export default async function ProtectedPage() {
  // Check authentication
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/auth/login')
  }

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
        <div className="space-y-2">
          <h1 className="flex items-center gap-2 text-3xl font-bold">
            <Briefcase className="h-8 w-8" />
            Publish New Job
          </h1>
          <p className="text-muted-foreground">
            Upload a photo and add a description to publish a job directly to the map
          </p>
        </div>

        <div className="mx-auto w-full max-w-2xl">
          <UploadForm />
        </div>
      </div>

      {/* Published Jobs Section */}
      <div className="space-y-6">
        <div className="space-y-2">
          <h2 className="flex items-center gap-2 text-2xl font-bold">
            <FileText className="h-7 w-7" />
            Published Jobs
          </h2>
          <p className="text-sm text-muted-foreground">
            View and edit your published jobs
          </p>
        </div>

        <DraftJobsList initialJobs={publishedJobs || []} />
      </div>
    </div>
  )
}
