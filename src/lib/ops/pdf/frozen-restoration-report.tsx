import { renderToBuffer } from '@react-pdf/renderer'
import type { SupabaseClient } from '@supabase/supabase-js'
import { DryingReportPDF } from '@/lib/ops/pdf/drying-report'
import { buildDryingReportData } from '@/lib/ops/pdf/drying-report-data'
import {
  reportSha256,
  RESTORATION_REPORT_BUCKET,
  RESTORATION_REPORT_VERSION,
  restorationReportStoragePath,
} from '@/lib/ops/monthly-restoration-billing'

export type FrozenRestorationReport = {
  storagePath: string
  sha256: string
  version: number
  buffer: Buffer
}

async function renderReport(
  supabase: SupabaseClient,
  projectId: string,
): Promise<Buffer> {
  const built = await buildDryingReportData(supabase, projectId, true)
  if (!built) throw new Error('project_not_found')

  try {
    return Buffer.from(
      await renderToBuffer(<DryingReportPDF data={built.data} />),
    )
  } catch (renderError) {
    console.error(
      '[restoration/frozen-report] retrying without photos:',
      renderError,
    )
    return Buffer.from(
      await renderToBuffer(
        <DryingReportPDF data={{ ...built.data, includePhotos: false }} />,
      ),
    )
  }
}

/**
 * Render and store the close-time report once. The deterministic path and
 * upsert:false make a retry read the original bytes instead of replacing the
 * evidence after someone has edited the live project.
 */
export async function freezeRestorationReport(
  supabase: SupabaseClient,
  params: { projectId: string; customerId: string },
): Promise<FrozenRestorationReport> {
  const { data: existing } = await supabase
    .from('restoration_projects')
    .select(
      'final_report_storage_path, final_report_sha256, final_report_version',
    )
    .eq('id', params.projectId)
    .maybeSingle()

  if (
    existing?.final_report_storage_path &&
    existing.final_report_sha256 &&
    existing.final_report_version
  ) {
    const { data, error } = await supabase.storage
      .from(RESTORATION_REPORT_BUCKET)
      .download(existing.final_report_storage_path)
    if (error || !data) {
      throw new Error(error?.message ?? 'frozen_report_download_failed')
    }
    const buffer = Buffer.from(await data.arrayBuffer())
    const checksum = reportSha256(buffer)
    if (checksum !== existing.final_report_sha256) {
      throw new Error('frozen_report_checksum_mismatch')
    }
    return {
      storagePath: existing.final_report_storage_path,
      sha256: checksum,
      version: existing.final_report_version,
      buffer,
    }
  }

  const buffer = await renderReport(supabase, params.projectId)
  const storagePath = restorationReportStoragePath(params)
  const sha256 = reportSha256(buffer)

  const { error: uploadError } = await supabase.storage
    .from(RESTORATION_REPORT_BUCKET)
    .upload(storagePath, buffer, {
      contentType: 'application/pdf',
      cacheControl: '31536000',
      upsert: false,
    })

  if (uploadError && !/already exists|duplicate/i.test(uploadError.message)) {
    throw new Error(`frozen_report_upload_failed: ${uploadError.message}`)
  }

  // A concurrent retry may have won the upload. Always verify the bytes at the
  // immutable path before recording their digest.
  const { data: stored, error: downloadError } = await supabase.storage
    .from(RESTORATION_REPORT_BUCKET)
    .download(storagePath)
  if (downloadError || !stored) {
    throw new Error(
      `frozen_report_verification_failed: ${downloadError?.message ?? 'missing object'}`,
    )
  }
  const storedBuffer = Buffer.from(await stored.arrayBuffer())
  const storedSha256 = reportSha256(storedBuffer)
  if (storedSha256 !== sha256) {
    throw new Error('frozen_report_concurrent_content_mismatch')
  }

  const frozenAt = new Date().toISOString()
  const { error: updateError } = await supabase
    .from('restoration_projects')
    .update({
      final_report_storage_path: storagePath,
      final_report_sha256: sha256,
      final_report_version: RESTORATION_REPORT_VERSION,
      final_report_frozen_at: frozenAt,
      updated_at: frozenAt,
    })
    .eq('id', params.projectId)
    .is('final_report_storage_path', null)

  if (updateError) {
    throw new Error(`frozen_report_record_failed: ${updateError.message}`)
  }

  return {
    storagePath,
    sha256,
    version: RESTORATION_REPORT_VERSION,
    buffer: storedBuffer,
  }
}

export async function downloadFrozenRestorationReport(
  supabase: SupabaseClient,
  projectId: string,
): Promise<Buffer | null> {
  const { data: project } = await supabase
    .from('restoration_projects')
    .select('final_report_storage_path, final_report_sha256')
    .eq('id', projectId)
    .maybeSingle()
  if (!project?.final_report_storage_path) return null

  const { data, error } = await supabase.storage
    .from(RESTORATION_REPORT_BUCKET)
    .download(project.final_report_storage_path)
  if (error || !data)
    throw new Error(error?.message ?? 'report_download_failed')
  const buffer = Buffer.from(await data.arrayBuffer())
  if (
    project.final_report_sha256 &&
    reportSha256(buffer) !== project.final_report_sha256
  ) {
    throw new Error('frozen_report_checksum_mismatch')
  }
  return buffer
}
