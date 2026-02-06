import Link from 'next/link'
import { Button } from './ui/button'
import { createClient } from '@/supabase/server'

export async function AdminLink() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  // Only show admin button if user is logged in
  if (!user) {
    return null
  }

  return (
    <Button size="sm" variant="default" asChild>
      <Link href="/admin">Admin</Link>
    </Button>
  )
}
