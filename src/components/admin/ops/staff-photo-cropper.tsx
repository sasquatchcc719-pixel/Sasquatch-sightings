'use client'

import { useCallback, useState } from 'react'
import Cropper from 'react-easy-crop'
import type { Area } from 'react-easy-crop'
import { Button } from '@/components/ui/button'

interface Props {
  imageSrc: string
  onSave: (blob: Blob) => void
  onCancel: () => void
}

async function getCroppedBlob(
  imageSrc: string,
  pixelCrop: Area,
): Promise<Blob> {
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image()
    image.addEventListener('load', () => resolve(image))
    image.addEventListener('error', reject)
    image.src = imageSrc
  })

  const canvas = document.createElement('canvas')
  const size = 512
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!

  // Draw circular clip
  ctx.beginPath()
  ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2)
  ctx.clip()

  ctx.drawImage(
    img,
    pixelCrop.x,
    pixelCrop.y,
    pixelCrop.width,
    pixelCrop.height,
    0,
    0,
    size,
    size,
  )

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob)
        else reject(new Error('Canvas toBlob failed'))
      },
      'image/jpeg',
      0.92,
    )
  })
}

export function StaffPhotoCropper({ imageSrc, onSave, onCancel }: Props) {
  const [crop, setCrop] = useState({ x: 0, y: 0 })
  const [zoom, setZoom] = useState(1)
  const [croppedArea, setCroppedArea] = useState<Area | null>(null)
  const [saving, setSaving] = useState(false)

  const onCropComplete = useCallback((_: Area, croppedAreaPixels: Area) => {
    setCroppedArea(croppedAreaPixels)
  }, [])

  async function handleSave() {
    if (!croppedArea) return
    setSaving(true)
    try {
      const blob = await getCroppedBlob(imageSrc, croppedArea)
      onSave(blob)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/80 p-4 backdrop-blur">
      <div className="flex w-full max-w-md flex-col gap-4 rounded-2xl bg-slate-900 p-5 shadow-2xl">
        <div>
          <h3 className="text-lg font-semibold">Crop photo</h3>
          <p className="text-muted-foreground mt-0.5 text-sm">
            Drag to reposition · Scroll or pinch to zoom
          </p>
        </div>

        {/* Cropper canvas */}
        <div className="relative h-72 w-full overflow-hidden rounded-xl bg-slate-800">
          <Cropper
            image={imageSrc}
            crop={crop}
            zoom={zoom}
            aspect={1}
            cropShape="round"
            showGrid={false}
            onCropChange={setCrop}
            onZoomChange={setZoom}
            onCropComplete={onCropComplete}
          />
        </div>

        {/* Zoom slider */}
        <div className="flex items-center gap-3">
          <span className="text-muted-foreground w-6 text-center text-sm">
            −
          </span>
          <input
            type="range"
            min={1}
            max={3}
            step={0.01}
            value={zoom}
            onChange={(e) => setZoom(Number(e.target.value))}
            className="h-1.5 flex-1 cursor-pointer appearance-none rounded-full bg-slate-700 accent-emerald-500"
          />
          <span className="text-muted-foreground w-6 text-center text-sm">
            +
          </span>
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onCancel} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={() => void handleSave()} disabled={saving}>
            {saving ? 'Saving…' : 'Save photo'}
          </Button>
        </div>
      </div>
    </div>
  )
}
