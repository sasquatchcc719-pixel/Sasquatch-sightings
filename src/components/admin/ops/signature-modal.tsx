'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
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
  /**
   * Work removed from this invoice. Shown above the signature so the customer
   * signs knowing what is not being done and not being charged — this turns
   * the signature from a price approval into informed consent, which is the
   * document that matters if a claim is ever filed.
   */
  excludedItems?: Array<{
    name: string
    reason: string | null
    originalTotal: number | null
  }>
}

export function SignatureModal({
  isOpen,
  onClose,
  onSave,
  totalAmount,
  customerName: initialCustomerName = '',
  excludedItems = [],
}: SignatureModalProps) {
  const sigCanvas = useRef<SignatureCanvas>(null)
  const [customerName, setCustomerName] = useState(initialCustomerName)
  const [saving, setSaving] = useState(false)
  const [isEmpty, setIsEmpty] = useState(true)
  const [mounted, setMounted] = useState(false)
  const scrollYRef = useRef(0)

  useEffect(() => {
    setCustomerName(initialCustomerName)
  }, [initialCustomerName])

  useEffect(() => {
    setMounted(true)
  }, [])

  // Lock body scroll when modal is open
  useEffect(() => {
    if (isOpen) {
      scrollYRef.current = window.scrollY
      document.body.style.overflow = 'hidden'
      document.body.style.position = 'fixed'
      document.body.style.top = `-${scrollYRef.current}px`
      document.body.style.left = '0'
      document.body.style.right = '0'
      document.body.style.width = '100%'
    } else {
      document.body.style.overflow = ''
      document.body.style.position = ''
      document.body.style.top = ''
      document.body.style.left = ''
      document.body.style.right = ''
      document.body.style.width = ''
      window.scrollTo(0, scrollYRef.current)
    }

    return () => {
      document.body.style.overflow = ''
      document.body.style.position = ''
      document.body.style.top = ''
      document.body.style.left = ''
      document.body.style.right = ''
      document.body.style.width = ''
    }
  }, [isOpen])

  useEffect(() => {
    if (!isOpen) return
    sigCanvas.current?.clear()
    setIsEmpty(true)
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

  if (!isOpen || !mounted) return null

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex touch-none items-center justify-center overflow-hidden bg-black/80 p-3 sm:p-4"
      onTouchMove={(e) => e.preventDefault()}
    >
      <div
        className="bg-background relative flex h-[calc(100dvh-1.5rem)] w-full max-w-4xl touch-none flex-col overflow-hidden rounded-2xl shadow-2xl sm:h-[92dvh]"
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

        {/* Work not being performed — the customer sees this before signing. */}
        {excludedItems.length > 0 ? (
          <div className="border-b border-red-500/30 bg-red-50 p-4 dark:bg-red-950/30">
            <p className="text-sm font-bold uppercase tracking-wide text-red-700 dark:text-red-300">
              Not being cleaned today — not charged
            </p>
            <ul className="mt-2 space-y-1.5">
              {excludedItems.map((item, i) => (
                <li key={i} className="text-sm">
                  <span className="font-medium line-through opacity-70">
                    {item.name}
                  </span>
                  {item.originalTotal != null ? (
                    <span className="ml-2 font-mono text-xs opacity-60">
                      (${item.originalTotal.toFixed(2)} removed)
                    </span>
                  ) : null}
                  {item.reason ? (
                    <p className="text-muted-foreground text-xs">
                      {item.reason}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {/* Signature area */}
        <div className="flex min-h-0 flex-1 flex-col p-4">
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
                className: 'w-full h-full min-h-0 touch-none',
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
    </div>,
    document.body,
  )
}
