'use client'

/**
 * Foreman — field AI assistant. Snap a photo of a stain / fabric / care tag
 * (or just describe it), get back fiber ID, the exact in-stock product to
 * use with dilutions for the Hydro-Force, and any safety warnings.
 */

import { useRef, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Camera, Loader2, Send, X } from 'lucide-react'

type ChatMessage = {
  role: 'user' | 'assistant'
  text: string
  images?: string[]
}

const MAX_DIM = 1280

async function downscale(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, MAX_DIM / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas unavailable')
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  return canvas.toDataURL('image/jpeg', 0.8)
}

export default function ForemanPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [pendingImages, setPendingImages] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  const addPhotos = async (files: FileList | null) => {
    if (!files) return
    try {
      const imgs = await Promise.all([...files].slice(0, 3).map(downscale))
      setPendingImages((prev) => [...prev, ...imgs].slice(0, 3))
    } catch {
      setError('Could not read that photo')
    }
  }

  const send = async () => {
    if (busy || (!input.trim() && pendingImages.length === 0)) return
    setError(null)
    const userMessage: ChatMessage = {
      role: 'user',
      text: input.trim(),
      images: pendingImages,
    }
    const nextMessages = [...messages, userMessage]
    setMessages(nextMessages)
    setInput('')
    setPendingImages([])
    setBusy(true)
    try {
      const res = await fetch('/api/foreman/diagnose', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: nextMessages }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Diagnosis failed')
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', text: data.reply as string },
      ])
      setTimeout(
        () => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }),
        50,
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Diagnosis failed')
      // put the user's message back into the composer so nothing is lost
      setMessages(messages)
      setInput(userMessage.text)
      setPendingImages(userMessage.images ?? [])
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="flex min-h-screen flex-col bg-slate-950 text-slate-100">
      <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col p-4">
        <div className="mb-3 flex items-center gap-3">
          <Link href="/field" className="text-slate-400 hover:text-white">
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <h1 className="text-lg font-semibold">🔬 Foreman</h1>
          <span className="text-xs text-slate-500">
            stain &amp; fiber assistant
          </span>
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto pb-4">
          {messages.length === 0 ? (
            <div className="rounded-xl bg-white/5 p-4 text-sm text-slate-400">
              <p className="mb-2 font-medium text-slate-300">
                Snap a photo or describe what you&apos;re looking at:
              </p>
              <ul className="list-inside list-disc space-y-1 text-xs">
                <li>
                  &quot;Brown stain on beige carpet, smells like coffee&quot;
                </li>
                <li>Photo of a mystery couch fabric or its care tag</li>
                <li>
                  &quot;Water drop beads up on this fiber — what is it?&quot;
                </li>
              </ul>
              <p className="mt-2 text-xs">
                Answers only use chemicals that are in stock on the truck.
              </p>
            </div>
          ) : null}
          {messages.map((m, i) => (
            <div
              key={i}
              className={`max-w-[85%] rounded-xl px-3 py-2 text-sm whitespace-pre-wrap ${
                m.role === 'user'
                  ? 'ml-auto bg-blue-600/80'
                  : 'bg-white/10 text-slate-100'
              }`}
            >
              {m.images?.map((img, j) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  key={j}
                  src={img}
                  alt=""
                  className="mb-2 max-h-40 rounded-lg"
                />
              ))}
              {m.text}
            </div>
          ))}
          {busy ? (
            <div className="flex items-center gap-2 text-sm text-slate-400">
              <Loader2 className="h-4 w-4 animate-spin" /> Foreman is looking…
            </div>
          ) : null}
          {error ? (
            <p className="rounded-lg bg-red-950/60 px-3 py-2 text-sm text-red-400">
              {error}
            </p>
          ) : null}
          <div ref={bottomRef} />
        </div>

        {pendingImages.length > 0 ? (
          <div className="mb-2 flex gap-2">
            {pendingImages.map((img, i) => (
              <div key={i} className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={img}
                  alt=""
                  className="h-16 w-16 rounded-lg object-cover"
                />
                <button
                  type="button"
                  className="absolute -top-1.5 -right-1.5 rounded-full bg-black p-0.5"
                  onClick={() =>
                    setPendingImages((prev) => prev.filter((_, j) => j !== i))
                  }
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        ) : null}

        <div className="flex items-end gap-2">
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            capture="environment"
            multiple
            className="hidden"
            onChange={(e) => addPhotos(e.target.files)}
          />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="rounded-xl bg-white/10 p-3 hover:bg-white/20"
          >
            <Camera className="h-5 w-5" />
          </button>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                send()
              }
            }}
            rows={1}
            placeholder="Describe the stain / fabric…"
            className="max-h-32 flex-1 resize-none rounded-xl border border-white/10 bg-white/5 px-3 py-3 text-sm outline-none focus:border-white/30"
          />
          <button
            type="button"
            onClick={send}
            disabled={busy || (!input.trim() && pendingImages.length === 0)}
            className="rounded-xl bg-green-600 p-3 hover:bg-green-500 disabled:opacity-50"
          >
            <Send className="h-5 w-5" />
          </button>
        </div>
      </div>
    </main>
  )
}
