import { createClient } from '@/supabase/server'
import { DraftJobsList } from '@/components/admin/draft-jobs-list'
import { JobsPageClient } from '@/components/admin/jobs-page-client'
import { Button } from '@/components/ui/button'
import { Briefcase, FileText, Map } from 'lucide-react'
import Link from 'next/link'

export default async function AdminJobsPage() {
  const supabase = await createClient()

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
    `,
    )
    .eq('status', 'published')
    .order('published_at', { ascending: false })

  return (
    <div className="flex w-full flex-1 flex-col gap-12">
      {/* Publish Section */}
      <div className="space-y-6">
        <div className="space-y-2">
          <h1 className="flex items-center gap-2 text-3xl font-bold">
            <Briefcase className="h-8 w-8" />
            Publish New Job
          </h1>
          <p className="text-muted-foreground">
            Combine before/after photos, then fill in the details and publish to
            the map.
          </p>
          <Button asChild variant="outline" size="sm">
            <Link href="/">
              <Map className="mr-2 h-4 w-4" />
              View Map
            </Link>
          </Button>
        </div>

        <div className="mx-auto w-full max-w-2xl">
          <JobsPageClient />
        </div>
      </div>

      {/* Published Jobs */}
      <div className="space-y-4">
        <h2 className="flex items-center gap-2 text-2xl font-bold">
          <FileText className="h-7 w-7" />
          Published Jobs
        </h2>
        <DraftJobsList initialJobs={publishedJobs || []} />
      </div>
    </div>
  )
}
