import { createHash } from 'node:crypto'
import { createAdminClient } from '@/supabase/server'
import { z } from 'zod'

export const firmwareReportSchema = z
  .object({
    version: z.string().min(1).max(64),
    sequence: z.number().int().min(1).max(2147483647),
    state: z.enum([
      'ready',
      'installing',
      'pending',
      'confirmed',
      'rolled_back',
      'rejected',
      'download_failed',
    ]),
  })
  .strict()

// The caller supplies no tracker ID: scope every read/write to the enabled bearer owner.
export async function firmwareIdentity(request: Request) {
  const token = request.headers
    .get('authorization')
    ?.match(/^Bearer ([a-f0-9]{64})$/)?.[1]
  if (!token) return null
  const db = createAdminClient()
  const { data, error } = await db
    .from('fleet_trackers')
    .select('id')
    .eq('token_hash', createHash('sha256').update(token).digest('hex'))
    .eq('enabled', true)
    .maybeSingle()
  if (error) throw new Error('Firmware identity unavailable')
  return data ? { db, trackerId: data.id as string } : null
}

export async function assignedFirmware(
  identity: NonNullable<Awaited<ReturnType<typeof firmwareIdentity>>>,
) {
  const { data: target, error } = await identity.db
    .from('fleet_tracker_firmware')
    .select('release_id')
    .eq('tracker_id', identity.trackerId)
    .maybeSingle()
  if (error) throw new Error('Firmware target unavailable')
  if (!target?.release_id) return null
  const { data, error: releaseError } = await identity.db
    .from('fleet_firmware_releases')
    .select('id,sequence,version,board,size,sha256,signature,storage_path')
    .eq('id', target.release_id)
    .single()
  if (releaseError) throw new Error('Firmware release unavailable')
  return data
}

export function firmwareHeaders() {
  return {
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
  }
}
