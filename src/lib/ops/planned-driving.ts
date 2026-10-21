import type { DispatchJob } from './daily-dispatch'

export type PlannedDriveLeg = {
  fromJobId: string
  toJobId: string
  staffId: string
  seconds: number | null
  meters: number | null
  coordinates: [number, number][]
  error: string | null
}

/** Preserve the booked order, including stops whose location is missing. */
export function plannedJobPairs(
  jobs: DispatchJob[],
): [DispatchJob, DispatchJob][] {
  const byStaff = new Map<string, DispatchJob[]>()
  for (const job of jobs) {
    if (!job.staffId || job.status === 'cancelled') continue
    const group = byStaff.get(job.staffId) ?? []
    group.push(job)
    byStaff.set(job.staffId, group)
  }
  return [...byStaff.values()].flatMap((group) => {
    group.sort(
      (a, b) => a.start.localeCompare(b.start) || a.id.localeCompare(b.id),
    )
    return group
      .slice(1)
      .map((job, index) => [group[index], job] as [DispatchJob, DispatchJob])
  })
}

export async function loadPlannedDriving(
  jobs: DispatchJob[],
): Promise<PlannedDriveLeg[]> {
  const pairs = plannedJobPairs(jobs)
  const legs: PlannedDriveLeg[] = []
  // Bound provider concurrency on large schedules.
  for (let offset = 0; offset < pairs.length; offset += 4) {
    legs.push(
      ...(await Promise.all(
        pairs.slice(offset, offset + 4).map(async ([from, to]) => {
          const leg: PlannedDriveLeg = {
            fromJobId: from.id,
            toJobId: to.id,
            staffId: from.staffId!,
            seconds: null,
            meters: null,
            coordinates: [],
            error: null,
          }
          if (!from.location || !to.location)
            return { ...leg, error: 'A stop needs a verified location' }
          const token =
            process.env.MAPBOX_TOKEN || process.env.NEXT_PUBLIC_MAPBOX_TOKEN
          if (!token)
            return { ...leg, error: 'Driving estimates are not configured' }
          const coordinates = `${from.location.lng},${from.location.lat};${to.location.lng},${to.location.lat}`
          const url = new URL(
            `https://api.mapbox.com/directions/v5/mapbox/driving/${coordinates}`,
          )
          url.search = new URLSearchParams({
            access_token: token,
            geometries: 'geojson',
            overview: 'full',
            steps: 'false',
          }).toString()
          try {
            const response = await fetch(url, {
              signal: AbortSignal.timeout(10000),
              next: { revalidate: 86400 },
            })
            if (!response.ok) throw new Error('Routing unavailable')
            const body = await response.json()
            const route = body.routes?.[0]
            if (
              body.code !== 'Ok' ||
              !route ||
              !Number.isFinite(route.duration) ||
              route.duration < 0 ||
              !Number.isFinite(route.distance) ||
              route.distance < 0 ||
              route.geometry?.type !== 'LineString' ||
              !Array.isArray(route.geometry.coordinates) ||
              route.geometry.coordinates.length < 2 ||
              !route.geometry.coordinates.every(
                (point: unknown) =>
                  Array.isArray(point) &&
                  point.length >= 2 &&
                  Number.isFinite(point[0]) &&
                  Number.isFinite(point[1]),
              )
            )
              throw new Error('No driving route found')
            return {
              ...leg,
              seconds: route.duration,
              meters: route.distance,
              coordinates: route.geometry.coordinates as [number, number][],
            }
          } catch {
            // Preserve the jobs and other legs when a road route cannot be calculated.
            return { ...leg, error: 'Driving estimate unavailable' }
          }
        }),
      )),
    )
  }
  return legs
}
