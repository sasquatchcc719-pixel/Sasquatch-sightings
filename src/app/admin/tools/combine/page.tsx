'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { ArrowLeft, Download, Loader2, Upload, Image as ImageIcon } from 'lucide-react'
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
      const compressedBefore = await imageCompression(beforeImage, compressionOptions)
      console.log('Before image compressed:', beforeImage.size, '->', compressedBefore.size)

      console.log('Compressing after image...')
      const compressedAfter = await imageCompression(afterImage, compressionOptions)
      console.log('After image compressed:', afterImage.size, '->', compressedAfter.size)

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
    router.push('/admin')
  }

  return (
    <div className="container mx-auto px-4 py-8 max-w-6xl">
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
        <p className="text-gray-600 dark:text-gray-400 mt-2">
          Upload two images and combine them side-by-side with labels
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Upload Section */}
        <div className="space-y-6">
          <Card className="p-6">
            <h2 className="text-xl font-semibold mb-4">Upload Images</h2>

            {/* Before Image */}
            <div className="space-y-2 mb-6">
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
                <div className="mt-2 rounded-lg overflow-hidden border">
                  <img
                    src={beforePreview}
                    alt="Before preview"
                    className="w-full h-48 object-cover"
                  />
                </div>
              )}
            </div>

            {/* After Image */}
            <div className="space-y-2 mb-6">
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
                <div className="mt-2 rounded-lg overflow-hidden border">
                  <img
                    src={afterPreview}
                    alt="After preview"
                    className="w-full h-48 object-cover"
                  />
                </div>
              )}
            </div>

            {/* Options */}
            <div className="flex items-center space-x-2 mb-6">
              <Checkbox
                id="watermark"
                checked={addWatermark}
                onCheckedChange={(checked) => setAddWatermark(checked as boolean)}
              />
              <label
                htmlFor="watermark"
                className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
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
              <div className="mt-4 p-3 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-lg">
                <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
              </div>
            )}
          </Card>
        </div>

        {/* Preview Section */}
        <div className="space-y-6">
          <Card className="p-6">
            <h2 className="text-xl font-semibold mb-4">Combined Preview</h2>

            {combinedImage ? (
              <>
                <div className="rounded-lg overflow-hidden border mb-4">
                  <img
                    src={combinedImage}
                    alt="Combined before/after"
                    className="w-full h-auto"
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
              <div className="flex flex-col items-center justify-center h-64 text-center text-gray-500 dark:text-gray-400 border-2 border-dashed rounded-lg">
                <ImageIcon className="h-12 w-12 mb-4 opacity-50" />
                <p>Combined image will appear here</p>
                <p className="text-sm mt-2">Upload both images and click "Combine"</p>
              </div>
            )}
          </Card>

          {/* Tips */}
          <Card className="p-6 bg-blue-50 dark:bg-blue-950/30 border-blue-200 dark:border-blue-800">
            <h3 className="font-semibold mb-2 text-blue-900 dark:text-blue-100">
              💡 Tips
            </h3>
            <ul className="text-sm space-y-1 text-blue-800 dark:text-blue-200">
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
