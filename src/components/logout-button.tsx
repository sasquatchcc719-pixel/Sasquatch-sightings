'use client'

import { createClient } from '@/supabase/client'
import { Button } from '@/components/ui/button'
import { useRouter } from 'next/navigation'

export function LogoutButton() {
  const router = useRouter()

  const logout = async () => {
    const oneSignal = (
      window as unknown as { OneSignal?: { logout?: () => Promise<void> } }
    ).OneSignal
    try {
      await oneSignal?.logout?.()
    } catch {
      // Supabase logout must still proceed if push identity cleanup fails.
    }
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/auth/login')
  }

  return <Button onClick={logout}>Logout</Button>
}
