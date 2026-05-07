import { redirect } from 'next/navigation'
import Link from 'next/link'
import Image from 'next/image'
import { getUserWithRole } from '@/lib/auth'
import { AuthButton } from '@/components/auth-button'
import { GpsTrackerProvider } from '@/contexts/GpsTrackerContext'
import { TechClockControl } from '@/components/tech/tech-clock-control'

export default async function TechLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const { user, role } = await getUserWithRole()

  if (!user) redirect('/auth/login')
  if (
    !role ||
    role === 'partner' ||
    role === 'marketing' ||
    role === 'dispatcher'
  ) {
    redirect('/admin')
  }

  return (
    <GpsTrackerProvider
      gpsEnabled={role === 'tech' || role === 'admin' || role === 'owner'}
    >
      <main className="min-h-screen bg-slate-950 pb-24 text-slate-50">
        <div className="mx-auto flex min-h-screen w-full max-w-3xl flex-col">
          <header className="sticky top-0 z-20 border-b border-white/10 bg-slate-950/90 px-4 py-3 backdrop-blur">
            <div className="flex items-center justify-between gap-4">
              <Link
                href="/tech"
                className="flex items-center gap-2 font-semibold"
              >
                <Image
                  src="/vector6-no-background.svg"
                  alt="Sasquatch"
                  width={32}
                  height={32}
                />
                <span>Tech Portal</span>
              </Link>
              <AuthButton />
            </div>
          </header>
          <div className="flex-1 px-4 py-5">{children}</div>
        </div>
        <TechClockControl />
      </main>
    </GpsTrackerProvider>
  )
}
