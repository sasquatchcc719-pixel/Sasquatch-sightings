import { redirect } from 'next/navigation'
import { approveOAuth, denyOAuth } from './actions'
import { getUserWithRole } from '@/lib/auth'
import { createClient } from '@/supabase/server'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'

function validAuthorizationId(value: string | undefined): value is string {
  return Boolean(
    value &&
    value.length >= 10 &&
    value.length <= 256 &&
    /^[A-Za-z0-9_-]+$/.test(value),
  )
}

export default async function OAuthConsentPage({
  searchParams,
}: {
  searchParams: Promise<{ authorization_id?: string }>
}) {
  const { authorization_id: authorizationId } = await searchParams
  if (!validAuthorizationId(authorizationId)) {
    return (
      <ConsentError message="This OAuth authorization request is invalid." />
    )
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    const next = `/oauth/consent?authorization_id=${encodeURIComponent(authorizationId)}`
    redirect(`/auth/login?next=${encodeURIComponent(next)}`)
  }

  const { role, staff } = await getUserWithRole()
  if (role !== 'owner' || !staff?.is_active) {
    return (
      <ConsentError message="This account is signed in, but only Charles’s active owner account can connect to Sasquatch business data." />
    )
  }

  const { data, error } =
    await supabase.auth.oauth.getAuthorizationDetails(authorizationId)
  if (error || !data) {
    return (
      <ConsentError
        message={error?.message || 'This OAuth request is no longer available.'}
      />
    )
  }
  if ('redirect_url' in data) redirect(data.redirect_url)

  const scopes = data.scope.split(/\s+/).filter(Boolean)
  let clientHost = data.client.name
  try {
    clientHost = new URL(data.client.uri).hostname || data.client.name
  } catch {
    // The registered client name remains available if its URI is absent.
  }

  return (
    <main className="flex min-h-svh items-center justify-center bg-stone-100 p-6">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <p className="text-sm font-semibold tracking-wide text-emerald-800 uppercase">
            Sasquatch Carpet Cleaning
          </p>
          <CardTitle className="text-2xl">Allow read-only access?</CardTitle>
          <CardDescription>
            {data.client.name} ({clientHost}) wants to connect to Sasquatch
            Sightings as {staff.display_name}.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="rounded-lg border bg-white p-4 text-sm">
            <p className="font-semibold">This connection can read:</p>
            <p className="mt-1 text-stone-600">
              appointments, estimates, customers, availability, and recent
              inbound calls or voicemail transcriptions.
            </p>
            <p className="mt-3 font-semibold">It cannot:</p>
            <p className="mt-1 text-stone-600">
              book work, change records, send messages, run SQL, or make
              arbitrary web requests.
            </p>
          </div>
          <div>
            <p className="text-sm font-medium">Identity scopes requested</p>
            <p className="mt-1 text-sm text-stone-600">
              {scopes.join(', ') || 'No identity scopes listed'}
            </p>
          </div>
          <p className="text-sm text-stone-600">
            Availability is informational, uses the live 120-minute scheduling
            assumption, and does not reserve a time.
          </p>
          <div className="flex gap-3">
            <form action={approveOAuth} className="flex-1">
              <input
                type="hidden"
                name="authorization_id"
                value={data.authorization_id}
              />
              <Button type="submit" className="w-full">
                Allow read-only access
              </Button>
            </form>
            <form action={denyOAuth}>
              <input
                type="hidden"
                name="authorization_id"
                value={data.authorization_id}
              />
              <Button type="submit" variant="outline">
                Deny
              </Button>
            </form>
          </div>
        </CardContent>
      </Card>
    </main>
  )
}

function ConsentError({ message }: { message: string }) {
  return (
    <main className="flex min-h-svh items-center justify-center bg-stone-100 p-6">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <CardTitle>Connection unavailable</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-stone-600">{message}</p>
        </CardContent>
      </Card>
    </main>
  )
}
