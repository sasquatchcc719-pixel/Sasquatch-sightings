import 'server-only'

import { createAdminClient } from '@/supabase/server'
import {
  DEFAULT_NAVIGATION_PREFERENCES,
  cloneNavigationPreferences,
  normalizeNavigationPreferences,
  type NavigationPreferences,
} from '@/lib/admin-navigation'

export async function readNavigationPreferences(
  userId: string,
): Promise<NavigationPreferences> {
  const admin = createAdminClient()
  const { data, error } = await admin
    .from('admin_navigation_preferences')
    .select('preferences')
    .eq('user_id', userId)
    .maybeSingle()

  if (error) {
    if (!error.message.toLowerCase().includes('admin_navigation_preferences')) {
      console.error('[navigation-preferences] Read failed:', error.message)
    }
    return cloneNavigationPreferences(DEFAULT_NAVIGATION_PREFERENCES)
  }

  return data?.preferences
    ? normalizeNavigationPreferences(data.preferences)
    : cloneNavigationPreferences(DEFAULT_NAVIGATION_PREFERENCES)
}
