'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import {
  ArrowLeft,
  Download,
  Loader2,
  Upload,
  Image as ImageIcon,
} from 'lucide-react'
import { useRouter } from 'next/navigation'
import imageCompression from 'browser-image-compression'

export default function BeforeAfterCombinePage() {
  const router = useRouter()
  const [beforeImage, setBeforeImage] = useState<File | null>(null)
  const [afterImage, setAfterImage] = useState<File | null>(null)
  const [beforePreview, setBeforePreview] = useState<string | null>(null)
  const [afterPreview, setAfterPreview] = useState<string | null>(null)
  const [combinedImage, setCombinedImage] = useState<string | null>(null)
  const [addWatermark, setAddWatermark] = useState(true)
  const [isProcessing, setIsProcessing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Handle before image selection
  const handleBeforeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      setBeforeImage(file)
      const reader = new FileReader()
      reader.onloadend = () => {
        setBeforePreview(reader.result as string)
      }
      reader.readAsDataURL(file)
      setError(null)
      setCombinedImage(null)
    }
  }

  // Handle after image selection
  const handleAfterChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      setAfterImage(file)
      const reader = new FileReader()
      reader.onloadend = () => {
        setAfterPreview(reader.result as string)
      }
      reader.readAsDataURL(file)
      setError(null)
      setCombinedImage(null)
    }
  }

  // Combine images
  const handleCombine = async () => {
    if (!beforeImage || !afterImage) {
      setError('Please select both before and after images')
      return
    }

    setIsProcessing(true)
    setError(null)

    try {
      // Compress images before uploading (to avoid 413 Payload Too Large error)
      const compressionOptions = {
        maxSizeMB: 2, // Max 2MB per image
        maxWidthOrHeight: 2048, // Max dimension
        useWebWorker: true,
        fileType: 'image/jpeg' as const,
      }

      console.log('Compressing before image...')
      const compressedBefore = await imageCompression(
        beforeImage,
        compressionOptions,
      )
      console.log(
        'Before image compressed:',
        beforeImage.size,
        '->',
        compressedBefore.size,
      )

      console.log('Compressing after image...')
      const compressedAfter = await imageCompression(
        afterImage,
        compressionOptions,
      )
      console.log(
        'After image compressed:',
        afterImage.size,
        '->',
        compressedAfter.size,
      )

      const formData = new FormData()
      formData.append('before', compressedBefore)
      formData.append('after', compressedAfter)
      formData.append('watermark', addWatermark.toString())

      const response = await fetch('/api/tools/combine', {
        method: 'POST',
        body: formData,
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to combine images')
      }

      setCombinedImage(data.image)
    } catch (err) {
      console.error('Combine error:', err)
      setError(err instanceof Error ? err.message : 'Failed to combine images')
    } finally {
      setIsProcessing(false)
    }
  }

  // Download combined image
  const handleDownload = () => {
    if (!combinedImage) return

    const link = document.createElement('a')
    link.href = combinedImage
    link.download = `before-after-${Date.now()}.jpg`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  // Use for job upload (navigate with image data)
  const handleUseForJob = () => {
    if (!combinedImage) return

    // Store combined image in sessionStorage for job upload form
    sessionStorage.setItem('preloadedImage', combinedImage)
    // Add timestamp to force page refresh and useEffect to re-run
    router.push('/admin?fromCombine=' + Date.now())
  }

  return (
    <div className="container mx-auto max-w-6xl px-4 py-8">
      {/* Header */}
      <div className="mb-8">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => router.push('/admin')}
          className="mb-4"
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Jobs
        </Button>
        <h1 className="text-3xl font-bold">Before/After Image Combiner</h1>
        <p className="mt-2 text-gray-600 dark:text-gray-400">
          Upload two images and combine them side-by-side with labels
        </p>
      </div>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
        {/* Upload Section */}
        <div className="space-y-6">
          <Card className="p-6">
            <h2 className="mb-4 text-xl font-semibold">Upload Images</h2>

            {/* Before Image */}
            <div className="mb-6 space-y-2">
              <Label htmlFor="before">Before Image</Label>
              <div className="flex items-center gap-4">
                <Input
                  id="before"
                  type="file"
                  accept="image/*"
                  onChange={handleBeforeChange}
                  className="flex-1"
                />
                {beforePreview && (
                  <ImageIcon className="h-5 w-5 text-green-600" />
                )}
              </div>
              {beforePreview && (
                <div className="mt-2 overflow-hidden rounded-lg border">
                  <img
                    src={beforePreview}
                    alt="Before preview"
                    className="h-48 w-full object-cover"
                  />
                </div>
              )}
            </div>

            {/* After Image */}
            <div className="mb-6 space-y-2">
              <Label htmlFor="after">After Image</Label>
              <div className="flex items-center gap-4">
                <Input
                  id="after"
                  type="file"
                  accept="image/*"
                  onChange={handleAfterChange}
                  className="flex-1"
                />
                {afterPreview && (
                  <ImageIcon className="h-5 w-5 text-green-600" />
                )}
              </div>
              {afterPreview && (
                <div className="mt-2 overflow-hidden rounded-lg border">
                  <img
                    src={afterPreview}
                    alt="After preview"
                    className="h-48 w-full object-cover"
                  />
                </div>
              )}
            </div>

            {/* Options */}
            <div className="mb-6 flex items-center space-x-2">
              <Checkbox
                id="watermark"
                checked={addWatermark}
                onCheckedChange={(checked) =>
                  setAddWatermark(checked as boolean)
                }
              />
              <label
                htmlFor="watermark"
                className="text-sm leading-none font-medium peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
              >
                Add Sasquatch watermark
              </label>
            </div>

            {/* Combine Button */}
            <Button
              onClick={handleCombine}
              disabled={!beforeImage || !afterImage || isProcessing}
              className="w-full"
              size="lg"
            >
              {isProcessing ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Combining...
                </>
              ) : (
                <>
                  <Upload className="mr-2 h-4 w-4" />
                  Combine Images
                </>
              )}
            </Button>

            {/* Error Message */}
            {error && (
              <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 dark:border-red-800 dark:bg-red-950/30">
                <p className="text-sm text-red-600 dark:text-red-400">
                  {error}
                </p>
              </div>
            )}
          </Card>
        </div>

        {/* Preview Section */}
        <div className="space-y-6">
          <Card className="p-6">
            <h2 className="mb-4 text-xl font-semibold">Combined Preview</h2>

            {combinedImage ? (
              <>
                <div className="mb-4 overflow-hidden rounded-lg border">
                  <img
                    src={combinedImage}
                    alt="Combined before/after"
                    className="h-auto w-full"
                  />
                </div>

                <div className="space-y-2">
                  <Button
                    onClick={handleDownload}
                    className="w-full"
                    variant="default"
                  >
                    <Download className="mr-2 h-4 w-4" />
                    Download Combined Image
                  </Button>

                  <Button
                    onClick={handleUseForJob}
                    className="w-full"
                    variant="outline"
                  >
                    <Upload className="mr-2 h-4 w-4" />
                    Use for Job Upload
                  </Button>
                </div>
              </>
            ) : (
              <div className="flex h-64 flex-col items-center justify-center rounded-lg border-2 border-dashed text-center text-gray-500 dark:text-gray-400">
                <ImageIcon className="mb-4 h-12 w-12 opacity-50" />
                <p>Combined image will appear here</p>
                <p className="mt-2 text-sm">
                  Upload both images and click &quot;Combine&quot;
                </p>
              </div>
            )}
          </Card>

          {/* Tips */}
          <Card className="border-blue-200 bg-blue-50 p-6 dark:border-blue-800 dark:bg-blue-950/30">
            <h3 className="mb-2 font-semibold text-blue-900 dark:text-blue-100">
              💡 Tips
            </h3>
            <ul className="space-y-1 text-sm text-blue-800 dark:text-blue-200">
              <li>• Use high-quality images for best results</li>
              <li>• Images will be automatically resized to match</li>
              <li>• Labels are added automatically (BEFORE/AFTER)</li>
              <li>• Watermark appears in bottom-right corner</li>
              <li>• Download as JPG for easy sharing</li>
            </ul>
          </Card>
        </div>
      </div>
    </div>
  )
}
