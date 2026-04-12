'use client'

import { useState, useRef } from 'react'
import { UploadForm } from '@/components/admin/upload-form'
import { BeforeAfterCombiner } from '@/components/admin/before-after-combiner'
import { ArrowDown } from 'lucide-react'

export function JobsPageClient() {
  const [combinedImageDataUrl, setCombinedImageDataUrl] = useState<
    string | null
  >(null)
  const uploadRef = useRef<HTMLDivElement>(null)

  const handleCombined = (dataUrl: string) => {
    setCombinedImageDataUrl(dataUrl)
    // Scroll down to the upload form so the user sees it populated
    setTimeout(() => {
      uploadRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 100)
  }

  return (
    <div className="space-y-8">
      {/* Before/After Combiner */}
      <BeforeAfterCombiner onCombined={handleCombined} />

      {/* Visual connector */}
      {combinedImageDataUrl && (
        <div className="text-muted-foreground flex flex-col items-center gap-1 text-sm">
          <ArrowDown className="h-5 w-5 animate-bounce" />
          <span>Combined image loaded into upload form</span>
        </div>
      )}

      {/* Upload Form */}
      <div ref={uploadRef}>
        <UploadForm preloadedImageDataUrl={combinedImageDataUrl} />
      </div>
    </div>
  )
}
