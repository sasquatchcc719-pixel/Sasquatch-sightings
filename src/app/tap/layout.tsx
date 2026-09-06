import type { Metadata } from 'next'

const title = 'Sasquatch Carpet Cleaning | Your Digital Card'
const description =
  'Get a cleaning estimate, contact our team, or call for water damage help. Serving Monument, Colorado Springs, Castle Rock, and Black Forest.'

export const metadata: Metadata = {
  title,
  description,
  openGraph: {
    title,
    description,
    type: 'website',
    images: [
      {
        url: '/sasquatch-website-logo.png',
        width: 2723,
        height: 1155,
        alt: 'Sasquatch Carpet Cleaning',
      },
    ],
  },
  twitter: {
    card: 'summary',
    title,
    description,
    images: ['/sasquatch-website-logo.png'],
  },
}

export default function TapLayout({ children }: { children: React.ReactNode }) {
  return children
}
