import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/supabase/server'
import { isRabeccaEnabled } from '@/lib/retell/rebecca-config'
import { executeRebeccaRetellTool } from '@/lib/retell/rebecca-tools'
import type {
  RetellFunctionName,
  RetellFunctionRequest,
} from '@/lib/retell/rebecca-types'
import { verifyRetellSignature } from '@/lib/retell/verify'

const SUPPORTED_FUNCTIONS = new Set<RetellFunctionName>([
  'get_service_catalog',
  'get_calendar_slots',
  'create_booking',
  'create_estimate',
  'list_caller_appointments',
  'schedule_reclean',
  'notify_admin',
])

function isSupportedFunction(value: unknown): value is RetellFunctionName {
  return (
    typeof value === 'string' &&
    SUPPORTED_FUNCTIONS.has(value as RetellFunctionName)
  )
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function requestArgs(payload: RetellFunctionRequest): Record<string, unknown> {
  if (payload.args || payload.arguments) {
    return asRecord(payload.args || payload.arguments)
  }
  return asRecord(payload)
}

function inferFunctionName(
  payload: RetellFunctionRequest,
  args: Record<string, unknown>,
  request: NextRequest,
): RetellFunctionName | null {
  const explicitName =
    payload.name ||
    payload.function_name ||
    request.nextUrl.searchParams.get('name') ||
    request.nextUrl.searchParams.get('function_name')
  if (isSupportedFunction(explicitName)) return explicitName

  if ('original_appointment_id' in args || 'issue_summary' in args) {
    return 'schedule_reclean'
  }
  if ('lookup_phone' in args || 'appointment_status' in args) {
    return 'list_caller_appointments'
  }
  if ('line_items' in args) return 'create_booking'
  if ('job_description' in args || 'visit_duration_minutes' in args) {
    return 'create_estimate'
  }
  if ('date' in args) return 'get_calendar_slots'
  if ('message' in args) return 'notify_admin'
  if ('category' in args || Object.keys(args).length === 0) {
    return 'get_service_catalog'
  }

  return null
}

async function writeRetellToolLog(params: {
  functionName: string
  args: Record<string, unknown>
  callId?: string
  callerPhone?: string
  success: boolean
  httpStatus: number
  responseBody?: unknown
  errorMessage?: string
}) {
  try {
    const supabase = createAdminClient()
    const responseRecord = asRecord(params.responseBody)
    const appointmentId =
      typeof responseRecord.appointment_id === 'string'
        ? responseRecord.appointment_id
        : typeof asRecord(responseRecord.data).appointment_id === 'string'
          ? String(asRecord(responseRecord.data).appointment_id)
          : null

    await supabase.from('retell_tool_logs').insert({
      call_id: params.callId || null,
      caller_phone: params.callerPhone || null,
      function_name: params.functionName,
      request_args: params.args,
      response_body: params.responseBody ?? null,
      success: params.success,
      http_status: params.httpStatus,
      error_message: params.errorMessage || null,
      appointment_id: appointmentId,
    })
  } catch (logError) {
    console.error('[retell/functions] Failed to write tool log:', logError)
  }
}

export async function POST(request: NextRequest) {
  const rawBody = await request.text()
  const signature = request.headers.get('x-retell-signature')

  if (!isRabeccaEnabled()) {
    return NextResponse.json(
      { success: false, message: 'Rabecca voice AI is disabled.' },
      { status: 503 },
    )
  }

  let payload: RetellFunctionRequest
  try {
    payload = JSON.parse(rawBody) as RetellFunctionRequest
  } catch {
    return NextResponse.json(
      { success: false, message: 'Invalid JSON body.' },
      { status: 400 },
    )
  }

  const args = requestArgs(payload)
  const functionName = inferFunctionName(payload, args, request)
  if (signature && !verifyRetellSignature({ rawBody, signature })) {
    console.warn(
      '[retell/functions] Ignoring invalid Retell signature on custom function call.',
    )
  }

  if (!functionName) {
    await writeRetellToolLog({
      functionName: 'unknown',
      args,
      callId: payload.call?.call_id,
      callerPhone: payload.call?.from_number,
      success: false,
      httpStatus: 400,
      responseBody: {
        success: false,
        message: 'Unsupported Rabecca function.',
      },
      errorMessage: 'Unsupported Rabecca function.',
    })
    return NextResponse.json(
      { success: false, message: 'Unsupported Rabecca function.' },
      { status: 400 },
    )
  }

  try {
    const supabase = createAdminClient()
    const result = await executeRebeccaRetellTool(functionName, args, {
      supabase,
      callId: payload.call?.call_id,
      callerPhone: payload.call?.from_number,
    })
    const status = result.success ? 200 : 400
    await writeRetellToolLog({
      functionName,
      args,
      callId: payload.call?.call_id,
      callerPhone: payload.call?.from_number,
      success: result.success,
      httpStatus: status,
      responseBody: result,
      errorMessage: result.success ? undefined : result.message,
    })

    return NextResponse.json(result, { status })
  } catch (error) {
    console.error('[retell/functions] Rabecca tool failed:', error)
    await writeRetellToolLog({
      functionName,
      args: asRecord(payload.args || payload.arguments),
      callId: payload.call?.call_id,
      callerPhone: payload.call?.from_number,
      success: false,
      httpStatus: 500,
      errorMessage: error instanceof Error ? error.message : 'Unknown error',
    })
    return NextResponse.json(
      { success: false, message: 'Rabecca tool failed.' },
      { status: 500 },
    )
  }
}
