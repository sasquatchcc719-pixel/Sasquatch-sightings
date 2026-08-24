import type { ReactNode } from 'react'

export function ReportShell({
  kicker,
  title,
  lede,
  when,
  lastSent,
  message,
  children,
  settings,
}: {
  kicker: string
  title: string
  lede: string
  when: string
  lastSent?: string | null
  message?: string | null
  children: ReactNode
  settings: ReactNode
}) {
  return (
    <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_21rem]">
      <div className="space-y-6">
        <header className="relative overflow-hidden rounded-3xl border border-white/10 bg-black/35 px-5 py-6 sm:px-7 sm:py-8">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 opacity-[0.12]"
            style={{
              backgroundImage:
                'radial-gradient(circle at 18% 20%, #fbbf24 0, transparent 32%), radial-gradient(circle at 88% 10%, #34d399 0, transparent 28%)',
            }}
          />
          <p className="relative text-[11px] font-semibold tracking-[0.28em] text-amber-300/90 uppercase">
            {kicker}
          </p>
          <h1
            className="relative mt-2 text-4xl leading-none text-white sm:text-5xl"
            style={{
              fontFamily: 'var(--font-telegram-display), Georgia, serif',
            }}
          >
            {title}
          </h1>
          <p className="relative mt-3 max-w-2xl text-sm leading-6 text-white/65">
            {lede}
          </p>
          <div className="relative mt-4 flex flex-wrap gap-2 text-[11px] tracking-wide text-white/50 uppercase">
            <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1">
              {when}
            </span>
            {lastSent ? (
              <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1">
                Last run {lastSent}
              </span>
            ) : null}
          </div>
        </header>

        {message ? (
          <section className="overflow-hidden rounded-3xl border border-emerald-500/20 bg-[#07140f]">
            <div className="flex items-center justify-between border-b border-emerald-500/15 px-5 py-3">
              <p className="text-[11px] font-semibold tracking-[0.22em] text-emerald-300/80 uppercase">
                Last Telegram
              </p>
              <p className="font-mono text-[10px] text-emerald-500/60">
                as sent to your phone
              </p>
            </div>
            <pre className="max-h-72 overflow-auto px-5 py-4 font-mono text-[12.5px] leading-6 whitespace-pre-wrap text-emerald-100/85">
              {message}
            </pre>
          </section>
        ) : null}

        {children}
      </div>

      <aside className="xl:sticky xl:top-4">{settings}</aside>
    </div>
  )
}

export function SettingsPanel({
  title,
  hint,
  children,
}: {
  title: string
  hint: string
  children: ReactNode
}) {
  return (
    <section className="rounded-3xl border border-white/10 bg-black/40 p-5">
      <p className="text-[11px] font-semibold tracking-[0.22em] text-amber-300/80 uppercase">
        What you can change
      </p>
      <h2
        className="mt-1 text-2xl text-white"
        style={{ fontFamily: 'var(--font-telegram-display), Georgia, serif' }}
      >
        {title}
      </h2>
      <p className="mt-1 mb-4 text-sm leading-5 text-white/50">{hint}</p>
      <div className="space-y-4">{children}</div>
    </section>
  )
}
