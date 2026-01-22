import { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Join Our Partner Program | Sasquatch Carpet Cleaning',
  description: 'Become a Sasquatch Carpet Cleaning referral partner. Earn $25 credit for every client you refer. Track your earnings and book free cleanings.',
  openGraph: {
    title: 'Join Sasquatch Carpet Cleaning Partner Program',
    description: 'Earn $25 credit for every referral. Track your earnings and book free cleanings.',
    images: ['/partner-og-image.png'],
    url: 'https://sightings.sasquatchcarpet.com/partners/register',
    type: 'website',
    siteName: 'Sasquatch Carpet Cleaning',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Join Sasquatch Carpet Cleaning Partner Program',
    description: 'Earn $25 credit for every referral',
    images: ['/partner-og-image.png'],
  },
}

type RegisterLayoutProps = {
  children: React.ReactNode
}

export default function RegisterLayout({ children }: RegisterLayoutProps) {
  return <>{children}</>
}
