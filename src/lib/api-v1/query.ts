import { ApiRequestError } from './http'

export const API_TIME_ZONE = 'America/Denver'
export const DEFAULT_LIMIT = 50
export const MAX_LIMIT = 100

export type Pagination = {
  limit: number
  offset: number
}

function parseNonNegativeInteger(
  value: string | null,
  fallback: number,
  name: string,
): number {
  if (value === null || value === '') return fallback
  if (!/^\d+$/.test(value)) {
    throw new ApiRequestError(`${name} must be a non-negative integer`)
  }

  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed)) {
    throw new ApiRequestError(`${name} is too large`)
  }
  return parsed
}

export function parsePagination(searchParams: URLSearchParams): Pagination {
  const limit = parseNonNegativeInteger(
    searchParams.get('limit'),
    DEFAULT_LIMIT,
    'limit',
  )
  const offset = parseNonNegativeInteger(
    searchParams.get('offset'),
    0,
    'offset',
  )

  if (limit < 1 || limit > MAX_LIMIT) {
    throw new ApiRequestError(`limit must be between 1 and ${MAX_LIMIT}`)
  }

  return { limit, offset }
}

export function requireDate(value: string | null, name = 'date'): string {
  const date = String(value || '').trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new ApiRequestError(`${name} must use YYYY-MM-DD format`)
  }

  const parsed = new Date(`${date}T00:00:00Z`)
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== date
  ) {
    throw new ApiRequestError(`${name} must be a valid calendar date`)
  }
  return date
}

export function optionalDate(
  value: string | null,
  name: string,
): string | null {
  return value ? requireDate(value, name) : null
}

export function parseEnum<T extends string>(
  value: string | null,
  name: string,
  allowed: readonly T[],
): T | null {
  if (!value) return null
  if (!allowed.includes(value as T)) {
    throw new ApiRequestError(`${name} must be one of: ${allowed.join(', ')}`)
  }
  return value as T
}

function timeZoneOffsetMilliseconds(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date)
  const values = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  )
  const asUtc = Date.UTC(
    Number(values.year),
    Number(values.month) - 1,
    Number(values.day),
    Number(values.hour),
    Number(values.minute),
    Number(values.second),
  )
  return asUtc - date.getTime()
}

function denverDateStart(date: string): Date {
  const [year, month, day] = date.split('-').map(Number)
  const localMidnightAsUtc = Date.UTC(year, month - 1, day)
  let instant = new Date(localMidnightAsUtc)

  for (let i = 0; i < 2; i += 1) {
    instant = new Date(
      localMidnightAsUtc - timeZoneOffsetMilliseconds(instant, API_TIME_ZONE),
    )
  }
  return instant
}

export function parseSince(value: string | null): string {
  if (!value) {
    return new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
  }

  const trimmed = value.trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return denverDateStart(requireDate(trimmed, 'since')).toISOString()
  }

  const parsed = new Date(trimmed)
  if (Number.isNaN(parsed.getTime())) {
    throw new ApiRequestError(
      'since must be an ISO 8601 timestamp or YYYY-MM-DD date',
    )
  }
  return parsed.toISOString()
}

export function paginationPayload(
  pagination: Pagination,
  total: number | null,
) {
  return {
    limit: pagination.limit,
    offset: pagination.offset,
    total: total ?? 0,
  }
}

export function ilikePattern(value: string): string {
  return `%${value.replace(/[\\%_]/g, '\\$&')}%`
}
