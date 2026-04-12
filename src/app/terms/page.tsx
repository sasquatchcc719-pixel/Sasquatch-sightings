import Link from 'next/link'

export const metadata = {
  title: 'Terms of Service | Sasquatch Carpet Cleaning',
  description: 'Terms of service for Sasquatch Carpet Cleaning',
}

export default function TermsPage() {
  return (
    <main className="bg-background min-h-screen p-6 md:p-12">
      <div className="mx-auto max-w-2xl space-y-6">
        <Link
          href="/"
          className="text-muted-foreground hover:text-foreground text-sm"
        >
          ← Back
        </Link>

        <h1 className="text-3xl font-bold">Terms of Service</h1>

        <p className="text-muted-foreground">Last updated: April 2026</p>

        <div className="space-y-4 text-sm leading-relaxed">
          <section>
            <h2 className="mb-2 text-lg font-semibold">Agreement to Terms</h2>
            <p>
              By accessing or using the Sasquatch Carpet Cleaning platform
              (&quot;Service&quot;), you agree to be bound by these Terms of
              Service. If you do not agree, please do not use the Service.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-lg font-semibold">
              Description of Service
            </h2>
            <p>
              Sasquatch Carpet Cleaning provides carpet cleaning, upholstery
              cleaning, restoration, and related services in the Colorado
              Springs area. Our platform allows customers to request quotes,
              book appointments, and manage their service history. Our internal
              tools integrate with third-party services including QuickBooks
              Online for accounting and invoicing.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-lg font-semibold">
              Third-Party Integrations
            </h2>
            <p>
              Our platform connects to QuickBooks Online to sync customer
              records and invoices. When you authorize a connection to
              QuickBooks, we access only the data necessary to create and manage
              customers and invoices within your QuickBooks account. You may
              disconnect the QuickBooks integration at any time from your admin
              settings. We do not store your QuickBooks login credentials.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-lg font-semibold">User Accounts</h2>
            <p>
              Admin access to the platform is restricted to authorized employees
              and owners of Sasquatch Carpet Cleaning. You are responsible for
              maintaining the security of your account credentials.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-lg font-semibold">
              Limitation of Liability
            </h2>
            <p>
              The Service is provided &quot;as is&quot; without warranties of
              any kind. Sasquatch Carpet Cleaning shall not be liable for any
              indirect, incidental, or consequential damages arising from the
              use of this platform.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-lg font-semibold">Changes to Terms</h2>
            <p>
              We may update these terms from time to time. Continued use of the
              Service after changes constitutes acceptance of the updated terms.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-lg font-semibold">Contact Us</h2>
            <p>
              Questions about these terms? Contact us at{' '}
              <a
                href="mailto:sasquatchcc719@gmail.com"
                className="text-green-500 hover:underline"
              >
                sasquatchcc719@gmail.com
              </a>
            </p>
          </section>
        </div>

        <p className="text-muted-foreground pt-6 text-xs">
          Sasquatch Carpet Cleaning · Colorado Springs, CO
        </p>
      </div>
    </main>
  )
}
