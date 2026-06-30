'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/supabase/client'

/**
 * Magic-link landing for admin "open client portal as this user" previews.
 * Mirrors /tech-preview: pulls tokens from the URL hash, sets the session, lands on /client.
 */
export default function ClientPreviewPage() {
  const router = useRouter()

  useEffect(() => {
    const hash = window.location.hash.slice(1)
    const params = new URLSearchParams(hash)
    const accessToken = params.get('access_token')
    const refreshToken = params.get('refresh_token')

    if (!accessToken || !refreshToken) {
      router.replace('/client')
      return
    }

    const supabase = createClient()
    supabase.auth
      .setSession({ access_token: accessToken, refresh_token: refreshToken })
      .then(() => router.replace('/client'))
  }, [router])

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 text-slate-300">
      <p className="text-sm">Opening client portal…</p>
    </div>
  )
}
