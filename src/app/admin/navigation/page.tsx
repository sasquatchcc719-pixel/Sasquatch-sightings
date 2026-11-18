import { redirect } from 'next/navigation'
import { getUserWithRole } from '@/lib/auth'
import { readNavigationPreferences } from '@/lib/admin-navigation-server'
import { NavigationLayoutEditor } from '@/components/admin/navigation-layout-editor'

export default async function NavigationEditorPage() {
  const { user, role } = await getUserWithRole()
  if (!user || (role !== 'owner' && role !== 'admin')) redirect('/admin')

  return (
    <NavigationLayoutEditor
      initialPreferences={await readNavigationPreferences(user.id)}
    />
  )
}
