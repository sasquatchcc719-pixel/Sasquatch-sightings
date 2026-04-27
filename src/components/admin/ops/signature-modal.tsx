'use client'

import { useEffect, useRef, useState } from 'react'
import SignatureCanvas from 'react-signature-canvas'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { X, RotateCcw, Check } from 'lucide-react'

type SignatureModalProps = {
  isOpen: boolean
  onClose: () => void
  onSave: (signatureData: string, customerName: string) => Promise<void>
  totalAmount: number
  customerName?: string
}

export function SignatureModal({
  isOpen,
  onClose,
  onSave,
  totalAmount,
  customerName: initialCustomerName = '',
}: SignatureModalProps) {
  const sigCanvas = useRef<SignatureCanvas>(null)
  const [customerName, setCustomerName] = useState(initialCustomerName)
  const [saving, setSaving] = useState(false)
  const [isEmpty, setIsEmpty] = useState(true)

  useEffect(() => {
    setCustomerName(initialCustomerName)
  }, [initialCustomerName])

  // Lock body scroll when modal is open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden'
      document.body.style.position = 'fixed'
      document.body.style.width = '100%'
    } else {
      document.body.style.overflow = ''
      document.body.style.position = ''
      document.body.style.width = ''
    }

    return () => {
      document.body.style.overflow = ''
      document.body.style.position = ''
      document.body.style.width = ''
    }
  }, [isOpen])

  const handleClear = () => {
    sigCanvas.current?.clear()
    setIsEmpty(true)
  }

  const handleSave = async () => {
    if (!sigCanvas.current || isEmpty) return
    if (!customerName.trim()) {
      alert('Please enter your name')
      return
    }

    setSaving(true)
    try {
      const signatureData = sigCanvas.current.toDataURL('image/png')
      await onSave(signatureData, customerName.trim())
      onClose()
    } catch (error) {
      console.error('Error saving signature:', error)
      alert('Failed to save signature')
    } finally {
      setSaving(false)
    }
  }

  const handleBegin = () => {
    setIsEmpty(false)
  }

  if (!isOpen) return null

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/80 p-4"
      onClick={(e) => {
        // Close if clicking backdrop (not the modal content)
        if (e.target === e.currentTarget) {
          onClose()
        }
      }}
    >
      <div
        className="bg-background relative flex w-full max-w-4xl flex-col rounded-2xl shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b p-4">
          <div>
            <h2 className="text-xl font-bold">Customer Signature</h2>
            <p className="text-muted-foreground text-sm">
              Total Amount:{' '}
              <span className="font-bold text-green-400">
                ${totalAmount.toFixed(2)}
              </span>
            </p>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose}>
            <X className="h-5 w-5" />
          </Button>
        </div>

        {/* Signature area */}
        <div className="flex flex-1 flex-col p-4">
          {/* Customer name input */}
          <div className="mb-4 max-w-md">
            <Label htmlFor="customer-name">Customer Name</Label>
            <Input
              id="customer-name"
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              placeholder="Enter your full name"
              className="mt-1"
            />
          </div>

          {/* Rotation hint for mobile */}
          <div className="mb-2 rounded-lg bg-blue-500/10 p-3 text-sm text-blue-400 md:hidden">
            💡 Tip: Rotate your phone sideways for more signing space
          </div>

          {/* Signature canvas */}
          <div className="border-border/60 relative flex-1 overflow-hidden rounded-xl border-2 border-dashed bg-white">
            <SignatureCanvas
              ref={sigCanvas}
              canvasProps={{
                className:
                  'w-full h-full min-h-[300px] md:min-h-[400px] touch-none',
                style: { touchAction: 'none' },
              }}
              backgroundColor="white"
              penColor="black"
              onBegin={handleBegin}
            />
            <div className="pointer-events-none absolute right-0 bottom-4 left-0 text-center text-sm text-slate-400">
              Sign above
            </div>
          </div>
        </div>

        {/* Footer with action buttons */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t p-4">
          <div className="flex gap-2">
            <Button variant="outline" onClick={handleClear} disabled={saving}>
              <RotateCcw className="mr-2 h-4 w-4" />
              Clear
            </Button>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={onClose}
              className="min-w-[100px] border-2"
            >
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              disabled={isEmpty || !customerName.trim() || saving}
              className="min-w-[140px] bg-green-600 hover:bg-green-700"
            >
              {saving ? (
                'Saving...'
              ) : (
                <>
                  <Check className="mr-2 h-4 w-4" />
                  Save Signature
                </>
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
