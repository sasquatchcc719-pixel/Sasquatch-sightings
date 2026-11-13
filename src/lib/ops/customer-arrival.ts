import { createHash, createHmac } from 'node:crypto'
import { createAdminClient } from '@/supabase/server'
import { dispatchLocation } from './daily-dispatch'

type Database = ReturnType<typeof createAdminClient>
type ArrivalAppointment = {
  id: string
  customer_id: string
  service_address_id?: string | null
  status?: string | null
  on_my_way_at?: string | null
  gps_lat?: unknown
  gps_lng?: unknown
}

type ArrivalRow = {
  status: 'en_route' | 'waiting' | 'arrived' | 'ended'
  latitude: number | null
  longitude: number | null
  destination_lat: number | null
  destination_lng: number | null
}

export type CustomerArrival =
  | { status: 'ended' | 'arrived' | 'waiting' }
  | {
      status: 'en_route'
      earliest: string
      latest: string
      arrivingSoon: boolean
    }

const TRACKING_ORIGIN = 'https://sightings.sasquatchcarpet.com'

function tokenHash(token: string) {
  return createHash('sha256').update(token).digest('hex')
}

export async function createCustomerArrivalUrl(
  db: Database,
  job: ArrivalAppointment,
  address: Parameters<typeof dispatchLocation>[0],
): Promise<string | null> {
  if (
    job.status !== 'on_my_way' ||
    !job.on_my_way_at ||
    !job.service_address_id
  )
    return null
  const destination = dispatchLocation(address, job.gps_lat, job.gps_lng)
  const secret =
    process.env.CUSTOMER_ARRIVAL_LINK_SECRET ||
    process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!destination || !secret) return null

  const token = createHmac('sha256', secret)
    .update(`customer-arrival:v1:${job.id}:${job.on_my_way_at}`)
    .digest('base64url')
  const { data, error } = await db.rpc('open_customer_arrival_link', {
    p_appointment_id: job.id,
    p_started_at: job.on_my_way_at,
    p_address_id: job.service_address_id,
    p_customer_id: job.customer_id,
    p_lat: destination.lat,
    p_lng: destination.lng,
    p_token_hash: tokenHash(token),
  })
  if (error) throw error
  return data === true ? `${TRACKING_ORIGIN}/arrival#${token}` : null
}

export function isArrivalToken(token: string) {
  return /^[A-Za-z0-9_-]{43}$/.test(token)
}

async function readArrival(db: Database, hash: string) {
  const { data, error } = await db
    .rpc('read_customer_arrival_link', { p_token_hash: hash })
    .maybeSingle<ArrivalRow>()
  if (error) throw error
  return data
}

export async function loadCustomerArrival(
  token: string,
): Promise<CustomerArrival> {
  if (!isArrivalToken(token)) return { status: 'ended' }
  const db = createAdminClient()
  const hash = tokenHash(token)
  const trip = await readArrival(db, hash)
  if (!trip) return { status: 'ended' }
  if (trip.status !== 'en_route') return { status: trip.status }
  const mapToken =
    process.env.MAPBOX_TOKEN || process.env.NEXT_PUBLIC_MAPBOX_TOKEN
  if (!mapToken) return { status: 'waiting' }

  const coordinates = `${trip.longitude},${trip.latitude};${trip.destination_lng},${trip.destination_lat}`
  const url = new URL(
    `https://api.mapbox.com/directions/v5/mapbox/driving-traffic/${coordinates}`,
  )
  url.search = new URLSearchParams({
    access_token: mapToken,
    overview: 'false',
    steps: 'false',
  }).toString()

  let seconds: number
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(4500),
      next: { revalidate: 30 },
    })
    if (!response.ok) return { status: 'waiting' }
    const body = await response.json()
    seconds = body.routes?.[0]?.duration
    if (body.code !== 'Ok' || !Number.isFinite(seconds) || seconds < 0)
      return { status: 'waiting' }
  } catch {
    return { status: 'waiting' }
  }

  // Recheck in case arrival or cancellation occurred during the routing request.
  const current = await readArrival(db, hash)
  if (!current) return { status: 'ended' }
  if (current.status !== 'en_route') return { status: current.status }

  const now = Date.now()
  return {
    status: 'en_route',
    earliest: new Date(now + Math.ceil(seconds / 60) * 60_000).toISOString(),
    latest: new Date(
      now + (Math.ceil(seconds / 60) + 5) * 60_000,
    ).toISOString(),
    arrivingSoon: seconds <= 5 * 60,
  }
}
