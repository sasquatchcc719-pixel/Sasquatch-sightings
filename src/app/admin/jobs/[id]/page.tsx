import { redirect } from 'next/navigation'
import { createClient } from '@/supabase/server'
import { JobEditor } from '@/components/admin/job-editor'
import { ArrowLeft } from 'lucide-react'
import Link from 'next/link'

type PageProps = {
  params: Promise<{ id: string }>
}

export default async function JobDetailPage({ params }: PageProps) {
  const { id } = await params

  // Check authentication
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/auth/login')
  }

  // Fetch job with service details
  const { data: job, error } = await supabase
    .from('jobs')
    .select(
      `
      id,
      image_url,
      city,
      neighborhood,
      gps_lat,
      gps_lng,
      raw_voice_input,
      ai_description,
      invoice_amount,
      hours_worked,
      status,
      created_at,
      services (
        name
      )
    `
    )
    .eq('id', id)
    .single()

  if (error || !job) {
    redirect('/protected')
  }

  return (
    <div className="flex w-full flex-1 flex-col gap-6">
      {/* Back Button */}
      <Link
        href="/protected"
        className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Dashboard
      </Link>

      {/* Job Editor */}
      <JobEditor job={job} />
    </div>
  )
}
