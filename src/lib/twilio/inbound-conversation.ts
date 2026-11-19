import type { SupabaseClient } from '@supabase/supabase-js'

type ConversationRow = {
  id: string
  phone_number: string
  source: string
  status: string
  ops_customer_id: string | null
  lead_id?: string | null
  [key: string]: unknown
}

/**
 * A first outbound message starts as `admin_outbound`. The first customer
 * reply establishes the real inbound channel. Reuse that exact-phone thread
 * so the provider-confirmed outbound and inbound reply cannot split into an
 * empty shell plus a second history.
 */
export async function adoptAdminOutboundConversation(
  db: SupabaseClient,
  params: {
    phone: string
    inboundSource: string
    opsCustomerId: string | null
  },
): Promise<ConversationRow | null> {
  const candidate = await db
    .from('conversations')
    .select('*')
    .eq('phone_number', params.phone)
    .eq('source', 'admin_outbound')
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (candidate.error) throw candidate.error
  if (!candidate.data) return null

  const existingCustomer = candidate.data.ops_customer_id as string | null
  if (
    existingCustomer &&
    params.opsCustomerId &&
    existingCustomer !== params.opsCustomerId
  ) {
    // A shared phone must never move a thread between household contacts.
    return null
  }

  const changes = {
    source: params.inboundSource,
    status: 'active',
    ...(!existingCustomer && params.opsCustomerId
      ? { ops_customer_id: params.opsCustomerId }
      : {}),
  }
  const updated = await db
    .from('conversations')
    .update(changes)
    .eq('id', candidate.data.id)
  if (updated.error) throw updated.error

  return { ...(candidate.data as ConversationRow), ...changes }
}
