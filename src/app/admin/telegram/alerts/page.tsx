import {
  ReportShell,
  SettingsPanel,
} from '@/components/admin/telegram/ReportShell'

const ALERTS = [
  {
    name: 'New booking',
    when: 'The moment a job is booked',
    what: 'Name, time, total, source, services.',
    change: 'Lead source and booking method come from the job itself.',
  },
  {
    name: 'Job in 30 minutes',
    when: '30 minutes before start',
    what: 'Name, address, appointment link.',
    change: 'Tied to the appointment start time. No extra switch.',
  },
  {
    name: 'Google LSA lead',
    when: 'A Local Services text arrives',
    what: 'Name, phone, their message.',
    change: 'Twilio number routing. Off means missing leads.',
  },
  {
    name: 'Cancellation request',
    when: 'A customer asks to cancel',
    what: 'Alert only. Harry does not cancel.',
    change: 'Always on — missing one is worse than a extra ping.',
  },
  {
    name: 'Square payment',
    when: 'A card payment posts',
    what: 'Amount and invoice.',
    change: 'Square webhook. Tech also gets a push.',
  },
  {
    name: 'Client portal',
    when: 'Skip or a service request',
    what: 'What they asked, on which visit.',
    change: 'Lives with the client portal, not a separate list.',
  },
  {
    name: 'QuickBooks sync failure',
    when: 'The 15-minute sync cannot finish',
    what: 'Ops alert, not a report.',
    change: 'Fires only on failure.',
  },
  {
    name: 'New Google review',
    when: 'With Radar Daily, when one appears',
    what: 'Reviewer, stars, short quote.',
    change: 'Same listing as the Reviews channel.',
  },
]

export default function TelegramAlertsPage() {
  return (
    <ReportShell
      kicker="Telegram channel"
      title="When something happens"
      lede="These are not reports. They interrupt on purpose. There is no mute board yet — each one is wired to a real event, not a schedule."
      when="As they happen"
      settings={
        <SettingsPanel
          title="Why no toggles"
          hint="A missed booking ping costs more than an extra message. If you want a quiet hour or a skip list, that is a new feature — say so and we will add it."
        >
          <p className="text-sm leading-6 text-white/60">
            Scout chat stays on the AI page. Ranking homework is the Monday
            push, not this list.
          </p>
        </SettingsPanel>
      }
    >
      <div className="grid gap-3 md:grid-cols-2">
        {ALERTS.map((alert) => (
          <article
            key={alert.name}
            className="rounded-3xl border border-white/10 bg-black/30 p-5"
          >
            <p className="text-[11px] tracking-[0.2em] text-amber-300/80 uppercase">
              {alert.when}
            </p>
            <h2
              className="mt-1 text-2xl text-white"
              style={{
                fontFamily: 'var(--font-telegram-display), Georgia, serif',
              }}
            >
              {alert.name}
            </h2>
            <p className="mt-2 text-sm leading-6 text-white/65">{alert.what}</p>
            <p className="mt-3 text-xs leading-5 text-white/40">
              {alert.change}
            </p>
          </article>
        ))}
      </div>
    </ReportShell>
  )
}
