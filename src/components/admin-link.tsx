import Link from 'next/link'
import { Button } from './ui/button'
import { getUserWithRole } from '@/lib/auth'

export async function AdminLink() {
  const { user, role } = await getUserWithRole()

  // If no user, show Login button
  if (!user) {
    return (
      <Button
        size="sm"
        variant="outline"
        className="opacity-50 hover:opacity-100"
        asChild
      >
        <Link href="/auth/login">Login</Link>
      </Button>
    )
  }

  if (role === 'partner') {
    return null
  }

  return (
    <Button size="sm" variant="default" asChild>
      <Link href="/admin">Admin</Link>
    </Button>
  )
}
