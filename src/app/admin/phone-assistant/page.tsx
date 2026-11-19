import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getUserWithRole } from '@/lib/auth'
import { createAdminClient } from '@/supabase/server'
import { getVoiceSession } from '@/lib/phone-assistant/records'

import {
  coachingTopics,
  getActiveCoaching,
  getCallReview,
  parseReview,
} from '@/lib/phone-assistant/coaching'
import { setCoachingExcluded } from './actions'

function displayTime(instant: string) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Denver',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  }).format(new Date(instant))
}

export default async function PhoneAssistantCalls({
  searchParams,
}: {
  searchParams: Promise<{ call?: string }>
}) {
  const { user, role } = await getUserWithRole()
  if (!user || (role !== 'owner' && role !== 'admin')) notFound()
  const requested = (await searchParams).call
  const db = createAdminClient()
  if (requested) {
    if (!/^CA[0-9a-f]{32}$/i.test(requested)) notFound()
    const session = await getVoiceSession(requested, db)
    if (!session) notFound()
    const { review, excluded } = await getCallReview(db, requested)
    return (
      <main className="mx-auto max-w-3xl space-y-5">
        <Link
          className="text-sm text-emerald-300 underline"
          href="/admin/phone-assistant"
        >
          All after-hours calls
        </Link>
        <h1 className="text-2xl font-semibold">
          Call from {session.callerPhone}
        </h1>
        <p className="text-muted-foreground">
          {displayTime(session.startedAt)} ·{' '}
          {session.status === 'active'
            ? 'In progress'
            : session.answeredAt
              ? 'Ended'
              : 'Assistant did not connect'}
          {session.pilot ? ' · Private preview' : ''}
        </p>
        {session.summary && (
          <section>
            <h2 className="mb-1 font-semibold">Summary</h2>
            <p>{session.summary}</p>
          </section>
        )}
        {review && (
          <section className="space-y-2 rounded-lg border p-4">
            <h2 className="font-semibold">Call review</h2>
            {review.partial && (
              <p>Reviewed the beginning and end of this long call.</p>
            )}
            {review.findings.length ? (
              <>
                <ul className="space-y-2">
                  {review.findings.map((f) => (
                    <li key={f.key}>
                      <strong>{coachingTopics[f.key].label}</strong>
                      <p>{f.note}</p>
                      <a
                        className="text-emerald-300 underline"
                        href={'#turn-' + f.sequence}
                      >
                        View transcript line
                      </a>
                    </li>
                  ))}
                </ul>
                <form
                  action={setCoachingExcluded.bind(null, requested, !excluded)}
                >
                  <button
                    type="submit"
                    className="rounded border px-3 py-2 text-sm"
                  >
                    {excluded
                      ? 'Include this call in coaching'
                      : 'Exclude this call from coaching'}
                  </button>
                </form>
                {excluded && (
                  <p className="text-muted-foreground">
                    Excluded from active coaching.
                  </p>
                )}
              </>
            ) : (
              <p>No coaching issues flagged.</p>
            )}
          </section>
        )}
        <section>
          <h2 className="mb-2 font-semibold">Transcript</h2>
          {!session.turns.length ? (
            <p className="text-muted-foreground">
              No transcribed speech has arrived.
            </p>
          ) : (
            <ol className="space-y-3">
              {session.turns.map((turn, index) => (
                <li
                  id={
                    turn.sequence === undefined
                      ? undefined
                      : 'turn-' + turn.sequence
                  }
                  className="rounded-md border p-3"
                  key={index}
                >
                  <strong>
                    {turn.role === 'user' ? 'Caller' : 'Phone assistant'}
                  </strong>
                  <p className="break-words whitespace-pre-wrap">
                    {turn.content}
                  </p>
                </li>
              ))}
            </ol>
          )}
        </section>
      </main>
    )
  }
  const [calls, active] = await Promise.all([
    db
      .from('phone_assistant_sessions')
      .select(
        'call_sid,caller_phone,pilot,started_at,ended_at,email_status,coaching_review,coaching_excluded',
      )
      .order('started_at', { ascending: false })
      .limit(100),
    getActiveCoaching(db),
  ])
  const { data, error } = calls
  if (error) throw error
  return (
    <main className="mx-auto max-w-3xl space-y-4">
      <h1 className="text-2xl font-semibold">After-hours calls</h1>
      <section className="space-y-2 rounded-lg border p-4">
        <h2 className="font-semibold">Active coaching</h2>
        <p className="text-muted-foreground text-sm">
          Harry uses up to three reminders when an issue appears on two of the
          last 20 reviewed calls.
        </p>
        {active.length ? (
          <ul className="list-disc space-y-1 pl-5">
            {active.map(({ key, calls }) => (
              <li key={key}>
                <strong>{coachingTopics[key].label}</strong> · {calls} calls
                <p>{coachingTopics[key].reminder}</p>
              </li>
            ))}
          </ul>
        ) : (
          <p>No recurring issues flagged.</p>
        )}
      </section>
      {!data.length ? (
        <p className="text-muted-foreground">No phone assistant calls yet.</p>
      ) : (
        <ul className="divide-y rounded-lg border">
          {data.map((call) => (
            <li key={call.call_sid}>
              <Link
                className="hover:bg-muted block p-4"
                href={
                  '/admin/phone-assistant?call=' +
                  encodeURIComponent(call.call_sid)
                }
              >
                <strong>{call.caller_phone}</strong>
                <div className="text-muted-foreground text-sm">
                  {displayTime(call.started_at)}
                  {call.pilot ? ' · Private preview' : ''}
                  {call.ended_at ? '' : ' · In progress'}
                  {parseReview(call.coaching_review)?.findings.some(
                    (f) => f.key === 'other',
                  )
                    ? ' · Needs investigation'
                    : parseReview(call.coaching_review)?.findings.length
                      ? ' · Coaching flagged'
                      : ''}
                  {call.coaching_excluded ? ' · Excluded from coaching' : ''}
                  {call.email_status === 'review'
                    ? ' · Email delivery needs review'
                    : ''}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  )
}
