'use server'

import { revalidatePath } from 'next/cache'
import { getUserWithRole } from '@/lib/auth'
import { createAdminClient } from '@/supabase/server'

export async function setCoachingExcluded(callSid: string, excluded: boolean) {
  const { user, role } = await getUserWithRole()
  if (!user || (role !== 'owner' && role !== 'admin'))
    throw Error('Unauthorized')
  if (!/^CA[0-9a-f]{32}$/i.test(callSid) || typeof excluded !== 'boolean')
    throw Error('Invalid call')
  const result = await createAdminClient()
    .from('phone_assistant_sessions')
    .update({ coaching_excluded: excluded })
    .eq('call_sid', callSid)
    .not('coaching_review', 'is', null)
    .select('call_sid')
    .single()
  if (result.error) throw result.error
  revalidatePath('/admin/phone-assistant')
}
