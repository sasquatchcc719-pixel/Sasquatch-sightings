'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'

export default function ReviewRedirectPage() {
  const params = useParams()
  const partnerId = params.partnerId as string
  const [error, setError] = useState<string | null>(null)
  const [partnerName, setPartnerName] = useState<string | null>(null)

  useEffect(() => {
    const trackAndRedirect = async () => {
      try {
        // Track the tap and get the redirect URL
        const response = await fetch('/api/review/track', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ partnerId }),
        })

        const data = await response.json()

        if (data.error) {
          setError(data.error)
          return
        }

        if (data.partnerName) {
          setPartnerName(data.partnerName)
        }

        if (data.redirectUrl) {
          // Small delay so user sees the transition
          setTimeout(() => {
            window.location.href = data.redirectUrl
          }, 500)
        } else {
          setError('No review URL configured for this partner')
        }
      } catch (err) {
        console.error('Failed to track review tap:', err)
        setError('Something went wrong. Please try again.')
      }
    }

    if (partnerId) {
      trackAndRedirect()
    }
  }, [partnerId])

  if (error) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-b from-blue-50 to-green-50 p-4 dark:from-gray-900 dark:to-gray-800">
        <div className="text-center">
          <p className="mb-4 text-6xl">😕</p>
          <h1 className="mb-2 text-xl font-bold text-gray-800 dark:text-gray-200">
            Oops!
          </h1>
          <p className="text-gray-600 dark:text-gray-400">{error}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-b from-blue-50 to-green-50 p-4 dark:from-gray-900 dark:to-gray-800">
      <div className="text-center">
        <p className="mb-4 animate-bounce text-6xl">⭐</p>
        <h1 className="mb-2 text-xl font-bold text-gray-800 dark:text-gray-200">
          {partnerName
            ? `Thanks for visiting ${partnerName}!`
            : 'One moment...'}
        </h1>
        <p className="text-gray-600 dark:text-gray-400">
          Taking you to leave a review...
        </p>
        <div className="mt-4">
          <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-green-500 border-r-transparent"></div>
        </div>
      </div>
    </div>
  )
}
