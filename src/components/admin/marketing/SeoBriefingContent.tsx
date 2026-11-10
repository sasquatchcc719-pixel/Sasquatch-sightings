import Link from 'next/link'
import { seoChangeSchema } from '@/lib/seo/change-ledger'
import type { SeoBriefing } from '@/lib/seo/briefing'

export function SeoBriefingContent({ report }: { report: SeoBriefing }) {
  return (
    <>
      <p className="text-xs text-slate-500">
        Read {new Date(report.generatedAt).toLocaleString()}. Source dates below
        may differ.
      </p>
      {report.sections.map((section) => (
        <section
          key={section.title}
          className="rounded-xl border border-white/10 bg-white/5 p-4"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-semibold text-white">{section.title}</h2>
            <span className="rounded-full border border-white/15 px-2 py-1 text-xs text-slate-300 uppercase">
              {section.state}
            </span>
          </div>
          <p className="mt-3 text-lg text-white">{section.summary}</p>
          {section.period && (
            <p className="mt-1 text-sm text-sky-300">
              {section.period.start} to {section.period.end}
            </p>
          )}
          <p className="mt-2 text-sm leading-relaxed text-slate-400">
            {section.detail}
          </p>
          {section.businessOutcomes && (
            <div className="mt-3 space-y-3 text-sm text-slate-300">
              <p className="text-xs text-slate-400">
                Status as of{' '}
                {section.measuredAt
                  ? new Date(section.measuredAt).toLocaleString()
                  : 'unknown'}
                ; includes later bookings.
              </p>
              <p>
                Linked appointments: {section.businessOutcomes.open} booked or
                in progress · {section.businessOutcomes.completed} completed ·{' '}
                {section.businessOutcomes.cancelled} cancelled ·{' '}
                {section.businessOutcomes.other} other status.
              </p>
              <ul
                className="space-y-1"
                aria-label="Linked appointments by service town"
              >
                {section.businessOutcomes.byTown.map((town) => (
                  <li key={town.town}>
                    {town.town}: {town.appointments} linked ({town.open} open,{' '}
                    {town.completed} completed, {town.cancelled} cancelled,{' '}
                    {town.other} other).
                  </li>
                ))}
              </ul>
              <p>
                Saved booking sources:{' '}
                {section.businessOutcomes.recordedSources
                  .map((source) => `${source.label}: ${source.appointments}`)
                  .join(' · ') || 'No verified linked appointments'}
                . Recorded labels, not verified acquisition channels.
              </p>
              <p>
                {section.businessOutcomes.googleReferrerAppointments} linked
                appointments have a Google referrer in the same session. Organic
                versus paid is unknown; a Google referrer does not override the
                saved booking source.
              </p>
              <p className="text-slate-400">
                {section.businessOutcomes.unlinkedQuoteSessions} quote sessions
                have no recorded booking link;{' '}
                {section.businessOutcomes.unresolvedQuoteSessions} have an
                unresolved, ambiguous or ineligible link. These are not proven
                lost leads. {section.businessOutcomes.excludedQuoteSessions}{' '}
                internal/test sessions excluded. Territory is unknown for
                unlinked sessions, even if they viewed a town page.
              </p>
            </div>
          )}
          <details className="mt-3 text-xs text-slate-500">
            <summary className="cursor-pointer">
              Source and measurement date
            </summary>
            <p className="mt-2 break-words">{section.source}</p>
            <p>
              {section.measuredAt
                ? new Date(section.measuredAt).toLocaleString()
                : 'Measurement date unavailable'}
            </p>
          </details>
        </section>
      ))}
      <section className="rounded-xl border border-sky-500/20 p-4">
        <h2 className="font-semibold text-white">Next actions</h2>
        <ol className="mt-2 list-inside list-decimal space-y-2 text-sm text-slate-300">
          {report.nextActions.slice(0, 2).map((action) => (
            <li key={action}>{action}</li>
          ))}
        </ol>
      </section>
      <section>
        <h2 className="font-semibold text-white">Recorded changes</h2>
        <p className="mt-1 text-sm text-slate-400">
          A dated change and a later result are not proof of cause and effect.
          Deployment status must be verified separately.
        </p>
        {report.changeHistoryError ? (
          <p className="mt-3 text-amber-200">
            Change history could not be read.
          </p>
        ) : report.changes.length === 0 ? (
          <p className="mt-3 text-slate-400">No changes recorded.</p>
        ) : (
          <ul className="mt-3 space-y-3">
            {report.changes.map((change) => {
              const evidence = seoChangeSchema.safeParse(change.seo_change)
              return (
                <li
                  key={change.id}
                  className="rounded-xl border border-white/10 p-3"
                >
                  <p className="text-xs text-slate-500">
                    {new Date(change.occurred_at).toLocaleDateString()} ·{' '}
                    {change.category}
                  </p>
                  <p className="mt-1 text-sm text-white">{change.title}</p>
                  {evidence.success && (
                    <details className="mt-2 text-sm text-slate-300">
                      <summary className="cursor-pointer">
                        Change plan and reviews
                      </summary>
                      <p className="mt-2">
                        Hypothesis: {evidence.data.hypothesis}
                      </p>
                      <p>Exact change: {evidence.data.exactChange}</p>
                      <p>
                        Deployment: {evidence.data.deployedAt ?? 'Not recorded'}{' '}
                        ·{' '}
                        {evidence.data.deploymentRef ??
                          'No deployment evidence'}
                      </p>
                      <p>
                        Review dates: {evidence.data.reviewDates.join(', ')}
                      </p>
                      <p>
                        Baseline measurements:{' '}
                        {evidence.data.baseline.length || 'None recorded'}
                      </p>
                      {evidence.data.outcomes.map((outcome, index) => (
                        <p key={index} className="mt-2">
                          {outcome.reviewedAt.slice(0, 10)}:{' '}
                          {outcome.observation} (
                          {outcome.interpretation.replaceAll('_', ' ')}).
                          Confounders:{' '}
                          {outcome.confounders.join('; ') ||
                            'None recorded; this does not prove absence.'}
                        </p>
                      ))}
                    </details>
                  )}
                  {change.detail && (
                    <details className="mt-2 text-xs text-slate-400">
                      <summary className="cursor-pointer">Evidence</summary>
                      <p className="mt-2 break-words whitespace-pre-wrap">
                        {change.detail}
                      </p>
                      {change.external_ref && (
                        <p className="mt-2 break-all">{change.external_ref}</p>
                      )}
                    </details>
                  )}
                </li>
              )
            })}
          </ul>
        )}
        <Link
          href="/admin/marketing/radar"
          className="mt-4 inline-block text-sm text-sky-300"
        >
          Open detailed Radar and change timeline →
        </Link>
      </section>
    </>
  )
}
