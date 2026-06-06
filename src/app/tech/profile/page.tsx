import { TechProfilePhotoForm } from '@/components/tech/tech-profile-photo-form'
import { requireAnyRole } from '@/lib/auth'
import { createAdminClient } from '@/supabase/server'

export default async function TechProfilePage() {
  const access = await requireAnyRole(['admin', 'owner', 'tech'])

  if (!access.staff) {
    return (
      <section className="rounded-2xl border border-white/10 bg-white/[0.06] p-6">
        <h1 className="text-2xl font-bold">Profile unavailable</h1>
        <p className="mt-2 text-sm text-slate-400">
          This account is not connected to a technician profile yet.
        </p>
      </section>
    )
  }

  const supabase = createAdminClient()
  const { data: staff, error } = await supabase
    .from('staff_users')
    .select('display_name, role, profile_image_url')
    .eq('id', access.staff.id)
    .eq('user_id', access.id)
    .maybeSingle()

  if (error) throw error

  return (
    <TechProfilePhotoForm
      displayName={staff?.display_name || access.staff.display_name}
      role={staff?.role || access.staff.role}
      initialImageUrl={staff?.profile_image_url || null}
    />
  )
}
