import type { createAdminClient } from '@/supabase/server'

type Db = ReturnType<typeof createAdminClient>
export function normalizedMarketingEmail(email: string | null | undefined) {
  return String(email || '')
    .trim()
    .toLowerCase()
}
export async function suppressedMarketingEmails(
  db: Db,
  emails: (string | null | undefined)[],
) {
  const addresses = [
    ...new Set(emails.map(normalizedMarketingEmail).filter(Boolean)),
  ]
  const suppressed = new Set<string>()
  // Bound each query below the Data API row cap to avoid truncated suppressions.
  for (let start = 0; start < addresses.length; start += 200) {
    const { data, error } = await db
      .from('email_marketing_suppressions')
      .select('email')
      .in('email', addresses.slice(start, start + 200))
    if (error || !Array.isArray(data))
      throw new Error('Marketing preferences could not be verified')
    for (const row of data || []) suppressed.add(row.email)
  }
  return suppressed
}
export async function isEmailMarketingSuppressed(
  db: Db,
  email: string | null | undefined,
) {
  return (await suppressedMarketingEmails(db, [email])).has(
    normalizedMarketingEmail(email),
  )
}
export async function unsubscribeEmailMarketing(
  db: Db,
  params: {
    customerId: string
    source: 'unsubscribe_link' | 'owner_request' | 'admin'
    sourceMessageId?: string | null
  },
) {
  const { data, error } = await db.rpc('unsubscribe_email_marketing', {
    p_customer_id: params.customerId,
    p_source: params.source,
    p_source_message_id: params.sourceMessageId || null,
  })
  if (error)
    throw Object.assign(new Error('Marketing unsubscribe could not be saved'), {
      code: error.code,
    })
  if (data?.success !== true)
    throw new Error('Marketing unsubscribe was not confirmed')
  return data as {
    success: true
    already_unsubscribed: boolean
    affected_customers: number
  }
}
