import { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Partner Portal | Sasquatch Carpet Cleaning',
  description: 'Earn $25 credit for every referral. Track your earnings and book free cleanings with our partner program.',
  openGraph: {
    title: 'Sasquatch Carpet Cleaning Partner Program',
    description: 'Earn $25 credit for every referral. Track your earnings and book free cleanings.',
    images: ['/partner-og-image.png'],
    url: 'https://sightings.sasquatchcarpet.com/partners',
    type: 'website',
    siteName: 'Sasquatch Carpet Cleaning',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Sasquatch Carpet Cleaning Partner Program',
    description: 'Earn $25 credit for every referral',
    images: ['/partner-og-image.png'],
  },
}

type PartnersLayoutProps = {
  children: React.ReactNode
}

export default function PartnersLayout({ children }: PartnersLayoutProps) {
  return <>{children}</>
}
