import Link from 'next/link'
import { Button } from './ui/button'
import { createClient } from '@/supabase/server'

export async function AdminLink() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

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

  return (
    <Button size="sm" variant="default" asChild>
      <Link href="/admin">Admin</Link>
    </Button>
  )
}
