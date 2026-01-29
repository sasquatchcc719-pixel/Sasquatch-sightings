import { redirect } from 'next/navigation'
import { createAdminClient } from '@/supabase/server'
import { getUserWithRole } from '@/lib/auth'
import { AdminPartnersView } from '@/components/admin/admin-partners-view'

export default async function AdminPartnersPage() {
  const { user, role } = await getUserWithRole()

  // Must be authenticated
  if (!user) {
    redirect('/auth/login')
  }

  // Must be an admin
  if (role !== 'admin') {
    redirect('/partners')
  }

  // Use admin client to bypass RLS
  const supabase = createAdminClient()

  // Fetch all partners (excluding admin records)
  const { data: partners } = await supabase
    .from('partners')
    .select('*')
    .neq('role', 'admin')
    .order('created_at', { ascending: false })

  // Fetch all referrals with partner info
  const { data: referrals } = await supabase
    .from('referrals')
    .select(
      `
      *,
      partners (
        id,
        name,
        company_name
      )
    `,
    )
    .order('created_at', { ascending: false })

  // Fetch outbound referrals (work sent TO partners)
  const { data: outboundReferrals } = await supabase
    .from('outbound_referrals')
    .select(
      `
      *,
      partner:partners (
        id,
        name,
        phone,
        company_name
      )
    `,
    )
    .order('created_at', { ascending: false })

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
        outboundReferrals={outboundReferrals || []}
      />
    </div>
  )
}
