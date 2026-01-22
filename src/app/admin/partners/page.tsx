import { createAdminClient } from '@/supabase/server'
import { AdminPartnersView } from '@/components/admin/admin-partners-view'

export default async function AdminPartnersPage() {
  // Use admin client to bypass RLS and see all partners/referrals
  const supabase = createAdminClient()

  // Fetch all partners
  const { data: partners, error: partnersError } = await supabase
    .from('partners')
    .select('*')
    .order('created_at', { ascending: false })

  if (partnersError) {
    console.error('Error fetching partners:', partnersError)
  }

  // Fetch all referrals with partner info
  const { data: referrals, error: referralsError } = await supabase
    .from('referrals')
    .select(
      `
      *,
      partners (
        id,
        name,
        company_name
      )
    `
    )
    .order('created_at', { ascending: false })

  if (referralsError) {
    console.error('Error fetching referrals:', referralsError)
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Partner Management</h1>
        <p className="text-muted-foreground">
          Manage partners and their referrals
        </p>
      </div>

      <AdminPartnersView
        partners={partners || []}
        referrals={referrals || []}
      />
    </div>
  )
}
