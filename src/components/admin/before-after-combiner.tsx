'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { Loader2, Upload, Image as ImageIcon, CheckCircle2 } from 'lucide-react'
import imageCompression from 'browser-image-compression'

interface BeforeAfterCombinerProps {
  onCombined: (dataUrl: string) => void
}

export function BeforeAfterCombiner({ onCombined }: BeforeAfterCombinerProps) {
  const [beforeImage, setBeforeImage] = useState<File | null>(null)
  const [afterImage, setAfterImage] = useState<File | null>(null)
  const [beforePreview, setBeforePreview] = useState<string | null>(null)
  const [afterPreview, setAfterPreview] = useState<string | null>(null)
  const [addWatermark, setAddWatermark] = useState(true)
  const [isProcessing, setIsProcessing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const [combinedPreview, setCombinedPreview] = useState<string | null>(null)

  const handleBeforeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setBeforeImage(file)
    setDone(false)
    const reader = new FileReader()
    reader.onloadend = () => setBeforePreview(reader.result as string)
    reader.readAsDataURL(file)
    setError(null)
  }

  const handleAfterChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setAfterImage(file)
    setDone(false)
    const reader = new FileReader()
    reader.onloadend = () => setAfterPreview(reader.result as string)
    reader.readAsDataURL(file)
    setError(null)
  }

  const handleCombine = async () => {
    if (!beforeImage && !afterImage) {
      setError('Please select at least one image')
      return
    }

    setIsProcessing(true)
    setError(null)

    try {
      const compressionOptions = {
        maxSizeMB: 2,
        maxWidthOrHeight: 2048,
        useWebWorker: true,
        fileType: 'image/jpeg' as const,
      }

      const formData = new FormData()

      if (beforeImage) {
        const compressedBefore = await imageCompression(
          beforeImage,
          compressionOptions,
        )
        formData.append('before', compressedBefore)
      }

      if (afterImage) {
        const compressedAfter = await imageCompression(
          afterImage,
          compressionOptions,
        )
        formData.append('after', compressedAfter)
      }

      formData.append('watermark', addWatermark.toString())

      const response = await fetch('/api/tools/combine', {
        method: 'POST',
        body: formData,
      })

      const data = await response.json()
      if (!response.ok)
        throw new Error(data.error || 'Failed to combine images')

      setDone(true)
      setCombinedPreview(data.image)
      onCombined(data.image)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to combine images')
    } finally {
      setIsProcessing(false)
    }
  }

  return (
    <Card className="space-y-6 p-6">
      <h2 className="flex items-center gap-2 text-xl font-semibold">
        <ImageIcon className="h-5 w-5" />
        Before / After Combiner
      </h2>
      <p className="text-muted-foreground text-sm">
        Upload both images to create a before/after comparison, or just one
        image to add a watermark.
      </p>

      <div className="grid grid-cols-2 gap-4">
        {/* Before */}
        <div className="space-y-2">
          <Label htmlFor="before">Before</Label>
          <Input
            id="before"
            type="file"
            accept="image/*"
            onChange={handleBeforeChange}
          />
          {beforePreview && (
            <img
              src={beforePreview}
              alt="Before"
              className="h-32 w-full rounded-lg border object-cover"
            />
          )}
        </div>

        {/* After */}
        <div className="space-y-2">
          <Label htmlFor="after">After</Label>
          <Input
            id="after"
            type="file"
            accept="image/*"
            onChange={handleAfterChange}
          />
          {afterPreview && (
            <img
              src={afterPreview}
              alt="After"
              className="h-32 w-full rounded-lg border object-cover"
            />
          )}
        </div>
      </div>

      <div className="flex items-center space-x-2">
        <Checkbox
          id="watermark"
          checked={addWatermark}
          onCheckedChange={(checked) => setAddWatermark(checked as boolean)}
        />
        <label htmlFor="watermark" className="text-sm font-medium">
          Add Sasquatch watermark
        </label>
      </div>

      {error && (
        <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
      )}

      <Button
        onClick={handleCombine}
        disabled={(!beforeImage && !afterImage) || isProcessing}
        className="w-full"
        size="lg"
        variant={done ? 'outline' : 'default'}
      >
        {isProcessing ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Processing...
          </>
        ) : done ? (
          <>
            <CheckCircle2 className="mr-2 h-4 w-4 text-green-500" />
            Ready to upload below
          </>
        ) : (
          <>
            <Upload className="mr-2 h-4 w-4" />
            {beforeImage && afterImage ? 'Combine Images' : 'Process Image'}
          </>
        )}
      </Button>
      {combinedPreview && (
        <div className="space-y-2">
          <p className="flex items-center gap-1 text-sm font-medium text-green-600 dark:text-green-400">
            <CheckCircle2 className="h-4 w-4" />
            Combined — loaded into upload form below
          </p>
          <img
            src={combinedPreview}
            alt="Combined before/after"
            className="w-full rounded-lg border"
          />
        </div>
      )}
    </Card>
  )
}
