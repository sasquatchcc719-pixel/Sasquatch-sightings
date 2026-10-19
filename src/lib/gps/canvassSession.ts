import type { SupabaseClient } from '@supabase/supabase-js'
import { haversineDistance } from './haversine'

export async function readCanvassPoints(
  supabase: SupabaseClient,
  sessionId: string,
) {
  const points: {
    lat: number
    lng: number
    accuracy_m: number | null
    recorded_at: string
  }[] = []
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await supabase
      .from('canvass_points')
      .select('lat, lng, accuracy_m, recorded_at')
      .eq('session_id', sessionId)
      .order('recorded_at', { ascending: true })
      .order('id', { ascending: true })
      .range(offset, offset + 999)
    if (error) throw new Error(error.message)
    points.push(...(data ?? []))
    if (!data || data.length < 1000) break
  }
  return points
}

export async function canvassTotals(
  supabase: SupabaseClient,
  sessionId: string,
) {
  const points = await readCanvassPoints(supabase, sessionId)
  let distance = 0
  for (let i = 1; i < points.length; i++) {
    distance += haversineDistance(
      points[i - 1].lat,
      points[i - 1].lng,
      points[i].lat,
      points[i].lng,
    )
  }
  return { point_count: points.length, distance_m: Math.round(distance) }
}
