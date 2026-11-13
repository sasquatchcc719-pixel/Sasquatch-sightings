import type { SupabaseClient } from '@supabase/supabase-js'
import type { FleetTracker } from '@/lib/fleet-tracking'

export type BoxTruckTravelProgress = {
  appointmentId: string
  destinationName: string
  eta: string
  minutesRemaining: number
  milesRemaining: number
  progressPercent: number
}

type RouteEstimate = { seconds: number; meters: number }

const METERS_PER_MILE = 1609.344

const one = <T>(value: T | T[] | null): T | null =>
  Array.isArray(value) ? (value[0] ?? null) : value

async function routeEstimate(
  from: { lat: number; lng: number },
  to: { lat: number; lng: number },
  traffic: boolean,
): Promise<RouteEstimate | null> {
  const token = process.env.MAPBOX_TOKEN || process.env.NEXT_PUBLIC_MAPBOX_TOKEN
  if (!token) return null
  const profile = traffic ? 'driving-traffic' : 'driving'
  const url = new URL(
    `https://api.mapbox.com/directions/v5/mapbox/${profile}/${from.lng},${from.lat};${to.lng},${to.lat}`,
  )
  url.search = new URLSearchParams({
    access_token: token,
    overview: 'false',
    steps: 'false',
  }).toString()
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(4500),
      next: { revalidate: traffic ? 30 : 7200 },
    })
    if (!response.ok) return null
    const body = await response.json()
    const route = body.routes?.[0]
    if (
      body.code !== 'Ok' ||
      !Number.isFinite(route?.duration) ||
      route.duration < 0 ||
      !Number.isFinite(route?.distance) ||
      route.distance < 0
    )
      return null
    return { seconds: route.duration, meters: route.distance }
  } catch {
    return null
  }
}

export async function readBoxTruckTravelProgress(
  db: SupabaseClient,
  tracker: FleetTracker,
  now = Date.now(),
): Promise<BoxTruckTravelProgress | null> {
  const lat = Number(tracker.latitude)
  const lng = Number(tracker.longitude)
  if (
    !tracker.enabled ||
    !tracker.gps_fix ||
    !tracker.gps_at ||
    now - Date.parse(tracker.gps_at) > 30_000 ||
    !Number.isFinite(lat) ||
    !Number.isFinite(lng) ||
    (lat === 0 && lng === 0)
  )
    return null

  const link = await db
    .from('customer_arrival_links')
    .select(
      'appointment_id,tracker_id,started_at,destination_lat,destination_lng,closed_reason',
    )
    .eq('tracker_id', tracker.id)
    .is('closed_reason', null)
    .gte('started_at', new Date(now - 2 * 60 * 60_000).toISOString())
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (link.error || !link.data) return null

  const [appointment, origin] = await Promise.all([
    db
      .from('ops_appointments')
      .select(
        'status,on_my_way_at,ops_customers!ops_appointments_customer_id_fkey(full_name,business_name)',
      )
      .eq('id', link.data.appointment_id)
      .single(),
    db
      .from('fleet_tracker_points')
      .select('latitude,longitude')
      .eq('tracker_id', tracker.id)
      .gte('recorded_at', link.data.started_at)
      .order('recorded_at', { ascending: true })
      .limit(1)
      .maybeSingle(),
  ])
  if (
    appointment.error ||
    !appointment.data ||
    appointment.data.status !== 'on_my_way' ||
    Date.parse(appointment.data.on_my_way_at ?? '') !==
      Date.parse(link.data.started_at)
  )
    return null

  const destination = {
    lat: Number(link.data.destination_lat),
    lng: Number(link.data.destination_lng),
  }
  const originPoint = origin.data
    ? {
        lat: Number(origin.data.latitude),
        lng: Number(origin.data.longitude),
      }
    : null
  if (
    !Number.isFinite(destination.lat) ||
    !Number.isFinite(destination.lng) ||
    !originPoint ||
    !Number.isFinite(originPoint.lat) ||
    !Number.isFinite(originPoint.lng)
  )
    return null

  const [remaining, original] = await Promise.all([
    routeEstimate({ lat, lng }, destination, true),
    routeEstimate(originPoint, destination, false),
  ])
  if (!remaining || !original) return null

  const currentLink = await db
    .from('customer_arrival_links')
    .select('closed_reason')
    .eq('appointment_id', link.data.appointment_id)
    .single()
  if (currentLink.error || currentLink.data?.closed_reason) return null

  const totalMeters = Math.max(original.meters, remaining.meters)
  const progressPercent = totalMeters
    ? Math.round((1 - remaining.meters / totalMeters) * 100)
    : 100
  const customer = one(appointment.data.ops_customers)
  const minutesRemaining = Math.max(0, Math.ceil(remaining.seconds / 60))
  return {
    appointmentId: link.data.appointment_id,
    destinationName:
      customer?.business_name || customer?.full_name || 'next stop',
    eta: new Date(now + minutesRemaining * 60_000).toISOString(),
    minutesRemaining,
    milesRemaining: Math.round((remaining.meters / METERS_PER_MILE) * 10) / 10,
    progressPercent: Math.max(0, Math.min(100, progressPercent)),
  }
}
