import type { Metadata } from 'next'
import { Geist } from 'next/font/google'
import { ThemeProvider } from 'next-themes'
import NextTopLoader from 'nextjs-toploader'
import { Analytics } from '@vercel/analytics/react'
import { ReactQueryDevtools } from '@tanstack/react-query-devtools'
import Script from 'next/script'
import './globals.css'
import ReactQueryProvider from '@/providers/ReactQueryProvider'

const defaultUrl = process.env.VERCEL_URL
  ? `https://${process.env.VERCEL_URL}`
  : 'http://localhost:3000'

export const metadata: Metadata = {
  metadataBase: new URL(defaultUrl),
  title: 'Sasquatch Sightings | Colorado Carpet Cleaning Truck Tracker',
  description:
    'Track Sasquatch Carpet Cleaning trucks across Colorado. Spot our truck, snap a photo, and win a free whole house cleaning!',
  openGraph: {
    title: 'Sasquatch Sightings | Colorado Carpet Cleaning Truck Tracker',
    description:
      'Track Sasquatch Carpet Cleaning trucks across Colorado. Spot our truck, snap a photo, and win a free whole house cleaning!',
    siteName: 'Sasquatch Carpet Cleaning',
    type: 'website',
    images: [
      {
        url: '/og-image.png',
        width: 1024,
        height: 1024,
        alt: 'Sasquatch Carpet Cleaning - Spot the truck and win!',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Sasquatch Sightings | Win a Free Cleaning!',
    description:
      'Spot our truck, snap a photo, and win a free whole house cleaning!',
    images: ['/og-image.png'],
  },
  icons: {
    apple: '/apple-touch-icon.png',
  },
}

const geistSans = Geist({
  variable: '--font-geist-sans',
  display: 'swap',
  subsets: ['latin'],
})

type RootLayoutProps = {
  children: React.ReactNode
}

export default function RootLayout({ children }: RootLayoutProps) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${geistSans.className} antialiased`}>
        {/* Google Analytics */}
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

        <NextTopLoader showSpinner={false} height={2} color="#2acf80" />
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <ReactQueryProvider>
            {children}
            <Analytics />
            <ReactQueryDevtools initialIsOpen={false} />
          </ReactQueryProvider>
        </ThemeProvider>
      </body>
    </html>
  )
}
