import { normalizePhone } from '@/lib/blacklist'
import { createAdminClient } from '@/supabase/server'

type AdminClient = ReturnType<typeof createAdminClient>

export async function suppressCustomersForBlacklistedPhone(
  supabase: AdminClient,
  rawPhone: string,
): Promise<string[]> {
  const phone = normalizePhone(rawPhone)
  const { data: customerRows, error: customerError } = await supabase
    .from('ops_customers')
    .select('id, phone')
    .not('phone', 'is', null)

  if (customerError) throw customerError

  const matchedCustomerIds = (customerRows || [])
    .filter(
      (customer) => normalizePhone(String(customer.phone || '')) === phone,
    )
    .map((customer) => customer.id as string)

  if (matchedCustomerIds.length === 0) return []

  const nowIso = new Date().toISOString()
  const [
    optOutResult,
    queueResult,
    dripResult,
    reviewResult,
    reactivationResult,
  ] = await Promise.all([
    supabase
      .from('ops_customers')
      .update({ email_opt_out: true, updated_at: nowIso })
      .in('id', matchedCustomerIds),
    supabase
      .from('ops_communication_queue')
      .update({
        status: 'cancelled',
        error_message: 'Suppressed: customer was blacklisted',
        updated_at: nowIso,
      })
      .in('customer_id', matchedCustomerIds)
      .eq('status', 'pending'),
    supabase
      .from('drip_campaign_enrollments')
      .update({ status: 'cancelled', updated_at: nowIso })
      .in('customer_id', matchedCustomerIds)
      .eq('status', 'active'),
    supabase
      .from('review_requests')
      .update({
        status: 'skipped',
        skip_reason: 'blacklisted',
        updated_at: nowIso,
      })
      .in('customer_id', matchedCustomerIds)
      .eq('status', 'pending'),
    supabase
      .from('reactivation_campaign_enrollments')
      .update({
        status: 'suppressed_blacklisted',
        stop_reason: 'blacklisted_customer',
        updated_at: nowIso,
      })
      .in('customer_id', matchedCustomerIds)
      .in('status', ['active', 'eligible', 'paused_recent_booking']),
  ])

  const cleanupErrors = [
    optOutResult.error,
    queueResult.error,
    dripResult.error,
    reviewResult.error,
    reactivationResult.error,
  ].filter(Boolean)

  if (cleanupErrors.length > 0) throw cleanupErrors[0]

  return matchedCustomerIds
}
