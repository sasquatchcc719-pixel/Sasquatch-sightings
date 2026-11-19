import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getUserWithRole } from '@/lib/auth'
import { createAdminClient } from '@/supabase/server'
import { getVoiceSession } from '@/lib/phone-assistant/records'

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
        <section>
          <h2 className="mb-2 font-semibold">Transcript</h2>
          {!session.turns.length ? (
            <p className="text-muted-foreground">
              No transcribed speech has arrived.
            </p>
          ) : (
            <ol className="space-y-3">
              {session.turns.map((turn, index) => (
                <li className="rounded-md border p-3" key={index}>
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
  const { data, error } = await db
    .from('phone_assistant_sessions')
    .select('call_sid,caller_phone,pilot,started_at,ended_at,email_status')
    .order('started_at', { ascending: false })
    .limit(100)
  if (error) throw error
  return (
    <main className="mx-auto max-w-3xl space-y-4">
      <h1 className="text-2xl font-semibold">After-hours calls</h1>
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
