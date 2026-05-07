import { redirect } from 'next/navigation'
import { getUserWithRole } from '@/lib/auth'

export default async function AuthRedirectPage() {
  const { user, role } = await getUserWithRole()

  if (!user) {
    redirect('/auth/login')
  }

  if (role === 'tech') {
    redirect('/tech')
  }

  if (role === 'partner') {
    redirect('/partners')
  }

  if (role === 'owner' || role === 'dispatcher' || role === 'marketing') {
    redirect('/admin/operations')
  }

  if (role === 'admin') {
    redirect('/admin')
  }

  // No recognized role
  redirect('/auth/login')
}
