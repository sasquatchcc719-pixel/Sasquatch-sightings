import Link from 'next/link'

export const metadata = {
  title: 'Privacy Policy | Sasquatch Carpet Cleaning',
  description: 'Privacy policy for Sasquatch Carpet Cleaning',
}

export default function PrivacyPage() {
  return (
    <main className="min-h-screen bg-background p-6 md:p-12">
      <div className="mx-auto max-w-2xl space-y-6">
        <Link href="/" className="text-sm text-muted-foreground hover:text-foreground">
          ← Back
        </Link>
        
        <h1 className="text-3xl font-bold">Privacy Policy</h1>
        
        <p className="text-muted-foreground">
          Last updated: January 2026
        </p>

        <div className="space-y-4 text-sm leading-relaxed">
          <section>
            <h2 className="text-lg font-semibold mb-2">Information We Collect</h2>
            <p>
              When you enter our contest or request services, we collect your name, 
              phone number, email address, and approximate location. If you upload 
              a photo, we store that image securely.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-2">How We Use Your Information</h2>
            <p>
              We use your information to contact you about our services, send you 
              promotional offers (like the coupon you received), and enter you into 
              our contests. We may also use photos you submit in our marketing materials.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-2">We Don&apos;t Sell Your Data</h2>
            <p>
              We will never sell, rent, or share your personal information with 
              third parties for their marketing purposes.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-2">Contact Us</h2>
            <p>
              If you have questions about this policy or want your information removed, 
              contact us at{' '}
              <a href="mailto:sasquatchcc719@gmail.com" className="text-green-500 hover:underline">
                sasquatchcc719@gmail.com
              </a>
            </p>
          </section>
        </div>

        <p className="text-xs text-muted-foreground pt-6">
          Sasquatch Carpet Cleaning · Colorado Springs, CO
        </p>
      </div>
    </main>
  )
}
