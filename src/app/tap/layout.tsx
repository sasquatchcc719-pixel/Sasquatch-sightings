import type { Metadata } from 'next'

const title = 'Sasquatch Carpet Cleaning'
const description =
  'Tap for water damage help or a free carpet cleaning estimate.'

export const metadata: Metadata = {
  title,
  description,
  openGraph: {
    title,
    description,
    siteName: title,
    type: 'website',
    images: [
      {
        url: '/tap/share-card.jpg',
        width: 1200,
        height: 630,
        alt: 'Sasquatch Carpet Cleaning logo on a wooden sign',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title,
    description,
    images: ['/tap/share-card.jpg'],
  },
}

export default function TapLayout({ children }: { children: React.ReactNode }) {
  return children
}
