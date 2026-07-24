import Link from 'next/link'
import Image from 'next/image'
import { AuthButton } from '@/components/auth-button'
import { requireAnyRole } from '@/lib/auth'
import { createAdminClient } from '@/supabase/server'

export default async function FieldPage() {
  await requireAnyRole(['admin', 'owner', 'tech'])

  const { count: maintenanceDueCount } = await createAdminClient()
    .from('maintenance_tasks')
    .select('id', { count: 'exact', head: true })
    .in('status', ['unassigned', 'scheduled'])

  return (
    <main className="min-h-screen bg-slate-950 pb-8 text-slate-50">
      <header className="sticky top-0 z-20 border-b border-white/10 bg-slate-950/95 px-4 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-2xl items-center justify-between gap-3">
          <Link href="/field" className="flex items-center gap-2 font-semibold">
            <Image
              src="/vector6-no-background.svg"
              alt="Sasquatch"
              width={30}
              height={30}
              priority
            />
            <span>Toolbox</span>
          </Link>
          <AuthButton />
        </div>
      </header>

      <div className="mx-auto max-w-2xl space-y-4 px-4 py-5">
        <div className="grid grid-cols-2 gap-2">
          <Link
            href="/field/canvass"
            className="rounded-xl border border-green-500/30 bg-green-500/10 px-3 py-3 text-center text-sm font-semibold text-green-300"
          >
            🚶 Canvassing
          </Link>
          <Link
            href="/field/foreman"
            className="rounded-xl border border-purple-500/30 bg-purple-500/10 px-3 py-3 text-center text-sm font-semibold text-purple-300"
          >
            🧠 Brain
          </Link>
          <Link
            href="/field/inventory"
            className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-3 text-center text-sm font-semibold text-amber-300"
          >
            📦 Truck inventory
          </Link>
          <Link
            href="/field/checkin"
            className="relative rounded-xl border border-sky-500/30 bg-sky-500/10 px-3 py-3 text-center text-sm font-semibold text-sky-300"
          >
            ⚙️ Gears
            {maintenanceDueCount ? (
              <span className="absolute -top-1.5 -right-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-amber-500 px-1 text-[10px] font-bold text-black">
                {maintenanceDueCount}
              </span>
            ) : null}
          </Link>
          <Link
            href="/tech"
            className="rounded-xl border border-white/10 bg-white/5 px-3 py-3 text-center text-sm font-medium text-slate-200"
          >
            Tech portal
          </Link>
          <Link
            href="/admin/operations"
            className="rounded-xl border border-white/10 bg-white/5 px-3 py-3 text-center text-sm font-medium text-slate-200"
          >
            Full calendar
          </Link>
        </div>
      </div>
    </main>
  )
}
