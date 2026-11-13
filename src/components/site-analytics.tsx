'use client'

import { Analytics } from '@vercel/analytics/react'
import { usePathname } from 'next/navigation'
import Script from 'next/script'

export function SiteAnalytics() {
  // The arrival URL contains a bearer token in its fragment.
  if (usePathname() === '/arrival') return null

  return (
    <>
      <Script
        src="https://www.googletagmanager.com/gtag/js?id=G-RWTGVVX5RK"
        strategy="afterInteractive"
      />
      <Script id="google-analytics" strategy="afterInteractive">
        {`
          window.dataLayer = window.dataLayer || [];
          function gtag(){dataLayer.push(arguments);}
          gtag('js', new Date());
          gtag('config', 'G-RWTGVVX5RK');
        `}
      </Script>
      <Analytics />
    </>
  )
}
