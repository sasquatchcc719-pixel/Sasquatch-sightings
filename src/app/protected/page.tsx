import { redirect } from 'next/navigation'
import { createClient } from '@/supabase/server'
import { UploadForm } from '@/components/admin/upload-form'
import { Briefcase } from 'lucide-react'

export default async function ProtectedPage() {
  // Check authentication
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/auth/login')
  }

  return (
    <div className="flex w-full flex-1 flex-col gap-8">
      {/* Header */}
      <div className="space-y-2">
        <h1 className="flex items-center gap-2 text-3xl font-bold">
          <Briefcase className="h-8 w-8" />
          New Job
        </h1>
        <p className="text-muted-foreground">
          Upload a photo and add job details to create a new entry
        </p>
      </div>

      {/* Upload Form */}
      <div className="mx-auto w-full max-w-2xl">
        <UploadForm />
      </div>
    </div>
  )
}
