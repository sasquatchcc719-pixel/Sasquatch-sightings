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

  // Fetch draft jobs with service details
  const { data: draftJobs } = await supabase
    .from('jobs')
    .select(
      `
      id,
      image_url,
      city,
      neighborhood,
      raw_voice_input,
      ai_description,
      created_at,
      services (
        name
      )
    `
    )
    .eq('status', 'draft')
    .order('created_at', { ascending: false })

  return (
    <div className="flex w-full flex-1 flex-col gap-12">
      {/* Upload Section */}
      <div className="space-y-8">
        <div className="space-y-2">
          <h1 className="flex items-center gap-2 text-3xl font-bold">
            <Briefcase className="h-8 w-8" />
            New Job
          </h1>
          <p className="text-muted-foreground">
            Upload a photo and add job details to create a new entry
          </p>
        </div>

        <div className="mx-auto w-full max-w-2xl">
          <UploadForm />
        </div>
      </div>

      {/* Draft Jobs Section */}
      <div className="space-y-6">
        <div className="space-y-2">
          <h2 className="flex items-center gap-2 text-2xl font-bold">
            <FileText className="h-7 w-7" />
            Draft Jobs
          </h2>
          <p className="text-sm text-muted-foreground">
            Edit descriptions and publish jobs to make them visible to the public
          </p>
        </div>

        <DraftJobsList initialJobs={draftJobs || []} />
      </div>
    </div>
  )
}
