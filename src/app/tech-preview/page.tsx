'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/supabase/client'

export default function TechPreviewPage() {
  const router = useRouter()

  useEffect(() => {
    const hash = window.location.hash.slice(1)
    const params = new URLSearchParams(hash)
    const accessToken = params.get('access_token')
    const refreshToken = params.get('refresh_token')

    if (!accessToken || !refreshToken) {
      router.replace('/tech')
      return
    }

    const supabase = createClient()
    supabase.auth
      .setSession({ access_token: accessToken, refresh_token: refreshToken })
      .then(() => router.replace('/tech'))
  }, [router])

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 text-slate-300">
      <p className="text-sm">Opening tech portal…</p>
    </div>
  )
}
