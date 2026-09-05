import { getUserWithRole } from '@/lib/auth'
import { createAdminClient, createClient } from '@/supabase/server'
import { loadClientPortalData } from '@/lib/ops/client-portal'
import { ClientPortal } from '@/components/client/client-portal'
import { redirect } from 'next/navigation'
import { loadCommercialData } from '@/lib/ops/commercial-server'

export default async function ClientPortalPage() {
  const { user, role, client } = await getUserWithRole()
  if (!user || role !== 'client_manager' || !client) {
    redirect('/redirect')
  }

  const admin = createAdminClient()
  const data = await loadClientPortalData(admin, client.customer_id)
  const commercial = await loadCommercialData(admin, client.customer_id)

  // Read the temporary-password flag from the session user's metadata.
  const sb = await createClient()
  const {
    data: { user: authUser },
  } = await sb.auth.getUser()
  const mustChangePassword = Boolean(
    authUser?.app_metadata?.must_change_password,
  )

  return (
    <ClientPortal
      businessName={commercial.businessName}
      managerName={client.display_name}
      initialData={data}
      initialCommercialData={commercial}
      canSign={client.can_sign_agreements === true}
      mustChangePassword={mustChangePassword}
    />
  )
}
