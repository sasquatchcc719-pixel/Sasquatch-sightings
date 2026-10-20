import { describe, expect, it } from 'vitest'
import {
  FleetTracker,
  trackerHistoryLines,
  trackerStatus,
  trackerTelemetrySchema,
} from './fleet-tracking'

const now = Date.parse('2026-10-19T23:00:00Z')
const tracker: FleetTracker = {
  id: '7a092418-a1be-4d3a-811e-bb1ab72e0d99',
  name: 'Prototype',
  enabled: true,
  firmware: '0.1.0',
  battery_v: 3.9,
  gps_fix: true,
  last_seen_at: new Date(now - 2000).toISOString(),
  gps_at: new Date(now - 2000).toISOString(),
  latitude: 39,
  longitude: -104,
  speed_mps: 5,
  bearing: 20,
  satellites: 8,
}
const point = {
  bootId: tracker.id,
  seq: 1,
  recordedAt: new Date(now).toISOString(),
  lat: 39,
  lng: -104,
  speedMps: 3,
  bearing: 30,
  satellites: 8,
}
const body = {
  firmware: '0.1.0',
  bootId: tracker.id,
  uptimeMs: 1234,
  batteryV: 3.9,
  gpsFix: true,
  points: [point],
}

describe('hardware tracker telemetry', () => {
  it('accepts an internet heartbeat without inventing a GPS position', () => {
    expect(
      trackerTelemetrySchema.safeParse({
        ...body,
        gpsFix: false,
        points: [],
        batteryV: null,
      }).success,
    ).toBe(true)
  })
  it.each([
    { lat: 91 },
    { lng: -181 },
    { speedMps: -1 },
    { bearing: 360 },
    { seq: -1 },
    { bootId: 'not-a-uuid' },
    { recordedAt: 'yesterday' },
  ])('rejects invalid measurements %s', (invalid) => {
    expect(
      trackerTelemetrySchema.safeParse({
        ...body,
        points: [{ ...point, ...invalid }],
      }).success,
    ).toBe(false)
  })
  it('bounds a batch so a device cannot submit unbounded history', () => {
    expect(
      trackerTelemetrySchema.safeParse({
        ...body,
        points: Array(33).fill(point),
      }).success,
    ).toBe(false)
  })
  it('labels missing, stale, and stationary fixes honestly', () => {
    expect(trackerStatus(tracker, now)).toBe('Moving')
    expect(trackerStatus({ ...tracker, speed_mps: 0 }, now)).toBe('Parked')
    expect(trackerStatus({ ...tracker, gps_fix: false }, now)).toBe(
      'Connected · waiting for GPS',
    )
    expect(
      trackerStatus(
        { ...tracker, gps_at: new Date(now - 31_000).toISOString() },
        now,
      ),
    ).toBe('Connected · waiting for GPS')
    expect(
      trackerStatus(
        { ...tracker, last_seen_at: new Date(now - 46_000).toISOString() },
        now,
      ),
    ).toBe('Offline')
    expect(trackerStatus({ ...tracker, last_seen_at: null }, now)).toBe(
      'Waiting for first connection',
    )
    expect(trackerStatus({ ...tracker, enabled: false }, now)).toBe('Disabled')
  })
  it('does not draw a route across gaps in reception', () => {
    const sample = (seconds: number, longitude: number) => ({
      recorded_at: new Date(now + seconds * 1000).toISOString(),
      latitude: 39,
      longitude,
      speed_mps: null,
      bearing: null,
    })
    expect(
      trackerHistoryLines([
        sample(0, -104),
        sample(2, -103.99),
        sample(300, -103.9),
        sample(302, -103.89),
      ]),
    ).toEqual([
      [
        [-104, 39],
        [-103.99, 39],
      ],
      [
        [-103.9, 39],
        [-103.89, 39],
      ],
    ])
  })
})
