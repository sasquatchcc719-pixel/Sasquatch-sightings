'use client'

import Image from 'next/image'
import Link from 'next/link'
import { useRef, useState } from 'react'
import { Camera, KeyRound, Loader2, User } from 'lucide-react'

type TechProfilePhotoFormProps = {
  displayName: string
  role: string
  initialImageUrl: string | null
}

export function TechProfilePhotoForm({
  displayName,
  role,
  initialImageUrl,
}: TechProfilePhotoFormProps) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [imageUrl, setImageUrl] = useState(initialImageUrl)
  const [isUploading, setIsUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  async function uploadPhoto(file: File) {
    setIsUploading(true)
    setError(null)
    setSuccess(null)

    try {
      const form = new FormData()
      form.append('file', file)

      const response = await fetch('/api/tech/profile/photo', {
        method: 'POST',
        body: form,
      })
      const result = (await response.json()) as {
        url?: string
        error?: string
      }

      if (!response.ok) {
        throw new Error(result.error || 'Photo upload failed')
      }

      setImageUrl(result.url ? `${result.url}?t=${Date.now()}` : null)
      setSuccess('Profile photo updated.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Photo upload failed')
    } finally {
      setIsUploading(false)
    }
  }

  return (
    <div className="space-y-5">
      <section className="rounded-3xl border border-emerald-400/20 bg-gradient-to-br from-emerald-500/15 to-cyan-500/10 p-5 shadow-2xl shadow-emerald-950/30">
        <p className="text-sm font-medium text-emerald-200">
          Technician Profile
        </p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight">
          {displayName}
        </h1>
        <p className="mt-1 text-sm text-slate-300 capitalize">{role}</p>
      </section>

      <section className="rounded-2xl border border-white/10 bg-white/[0.06] p-5">
        <div className="flex items-center gap-4">
          <div className="relative h-24 w-24 shrink-0 overflow-hidden rounded-full border border-white/15 bg-slate-900">
            {imageUrl ? (
              <Image
                key={imageUrl}
                src={imageUrl}
                alt={displayName}
                fill
                className="object-cover"
                unoptimized
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center">
                <User className="h-10 w-10 text-slate-500" />
              </div>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="font-semibold">Profile Photo</h2>
            <p className="mt-1 text-sm text-slate-400">
              This photo can be used in customer messages and technician-facing
              tools.
            </p>
          </div>
        </div>

        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0]
            if (file) void uploadPhoto(file)
            event.currentTarget.value = ''
          }}
        />

        <button
          type="button"
          disabled={isUploading}
          onClick={() => inputRef.current?.click()}
          className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-400 px-4 py-3 text-sm font-semibold text-slate-950 transition hover:bg-emerald-300 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isUploading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Camera className="h-4 w-4" />
          )}
          {imageUrl ? 'Replace photo' : 'Upload photo'}
        </button>

        {success ? (
          <p className="mt-3 text-sm text-emerald-300">{success}</p>
        ) : null}
        {error ? <p className="mt-3 text-sm text-red-300">{error}</p> : null}
      </section>

      <section className="rounded-2xl border border-white/10 bg-white/[0.06] p-5">
        <h2 className="font-semibold">Account</h2>
        <p className="mt-1 text-sm text-slate-400">
          Update your password any time from here.
        </p>
        <Link
          href="/auth/update-password"
          className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/10 px-4 py-3 text-sm font-semibold text-slate-100 transition hover:border-emerald-400/40 hover:bg-emerald-400/10"
        >
          <KeyRound className="h-4 w-4" />
          Change password
        </Link>
      </section>
    </div>
  )
}
