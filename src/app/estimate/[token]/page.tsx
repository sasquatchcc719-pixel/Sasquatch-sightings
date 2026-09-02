import { unstable_noStore as noStore } from 'next/cache'
import { createAdminClient } from '@/supabase/server'
import {
  EstimateTokenError,
  verifyEstimateDecisionToken,
} from '@/lib/ops/estimate-decision-token'
import {
  describeSegmentsSummary,
  isAreaUnit,
  isLinearUnit,
  parseAreaSegmentsInput,
} from '@/lib/ops/estimates'
import { EstimateDecision } from './estimate-decision'

const ACCENT = '#2d6a4f'
const TEXT_NUMBER = '(719) 249-8791'

type LoadedLine = {
  name: string
  qtyLabel: string | null
  unitPrice: number
  lineTotal: number
  notes: string | null
  breakdown: string | null
}

type LoadResult =
  | {
      ok: true
      estimateId: string
      token: string
      status: string
      customerName: string
      address: string
      lines: LoadedLine[]
      total: number
      locked: boolean
    }
  | { ok: false; title: string; message: string }

function unwrapRelation<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null
  return Array.isArray(value) ? value[0] || null : value
}

function money(n: number): string {
  return `$${Number(n || 0).toFixed(2)}`
}

async function loadEstimate(token: string): Promise<LoadResult> {
  noStore()

  let estimateId: string
  try {
    ;({ estimateId } = verifyEstimateDecisionToken(token))
  } catch (error) {
    if (error instanceof EstimateTokenError) {
      return {
        ok: false,
        title:
          error.code === 'expired'
            ? 'This estimate link has expired'
            : 'This estimate link is not valid',
        message: `Please text us at ${TEXT_NUMBER} and we'll send you a fresh copy.`,
      }
    }
    throw error
  }

  const supabase = createAdminClient()
  const { data: estimate, error } = await supabase
    .from('ops_appointments')
    .select(
      `
      id,
      estimate_status,
      quoted_total,
      converted_appointment_id,
      ops_customers!ops_appointments_customer_id_fkey ( full_name, first_name, business_name ),
      ops_service_addresses ( street_1, street_2, city, state, zip_code ),
      ops_appointment_line_items (
        name_snapshot, quantity, unit_price, line_total, notes,
        pricing_unit_snapshot, area_segments
      )
    `,
    )
    .eq('id', estimateId)
    .eq('kind', 'estimate')
    .single()

  if (error || !estimate) {
    return {
      ok: false,
      title: 'Estimate not found',
      message: `Please text us at ${TEXT_NUMBER} and we'll help.`,
    }
  }

  const customer = unwrapRelation(estimate.ops_customers)
  const addr = unwrapRelation(estimate.ops_service_addresses)

  const lines: LoadedLine[] = (
    Array.isArray(estimate.ops_appointment_line_items)
      ? estimate.ops_appointment_line_items
      : []
  ).map((li) => {
    const unit = li.pricing_unit_snapshot
    const qty = li.quantity != null ? Number(li.quantity) : null
    const qtyLabel = isAreaUnit(unit)
      ? `${qty ?? 0} sqft`
      : isLinearUnit(unit)
        ? `${qty ?? 0} linear ft`
        : qty && qty !== 1
          ? `×${qty}`
          : null

    // Show the rooms we actually measured. On a commercial bid this is the
    // difference between a number and a number the customer can check.
    const segments = parseAreaSegmentsInput(li.area_segments)
    const breakdown = segments ? describeSegmentsSummary(segments, unit) : null

    return {
      name: li.name_snapshot,
      qtyLabel,
      unitPrice: Number(li.unit_price ?? 0),
      lineTotal: Number(li.line_total ?? 0),
      notes: li.notes || null,
      breakdown,
    }
  })

  const status = String(estimate.estimate_status || 'draft')

  return {
    ok: true,
    estimateId,
    token,
    status,
    customerName:
      customer?.first_name || customer?.business_name || customer?.full_name || '',
    address: addr
      ? [addr.street_1, addr.street_2, `${addr.city}, ${addr.state} ${addr.zip_code}`]
          .filter(Boolean)
          .join(', ')
      : '',
    lines,
    total: Number(estimate.quoted_total ?? 0),
    locked: status === 'converted' || Boolean(estimate.converted_appointment_id),
  }
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ minHeight: '100vh', background: '#f4f4f4', padding: '24px 12px' }}>
      <div
        style={{
          maxWidth: 600,
          margin: '0 auto',
          background: '#fff',
          borderRadius: 8,
          overflow: 'hidden',
          boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
          fontFamily: 'Arial, Helvetica, sans-serif',
          color: '#333',
        }}
      >
        <div style={{ background: ACCENT, padding: '24px 32px', textAlign: 'center' }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="https://sightings.sasquatchcarpet.com/sasquatch-logo.png"
            alt="Sasquatch Carpet Cleaning"
            width={160}
            style={{ display: 'block', margin: '0 auto', maxWidth: 160, height: 'auto' }}
          />
        </div>
        <div style={{ padding: 32 }}>{children}</div>
        <div
          style={{
            background: '#f9f9f9',
            padding: '20px 32px',
            borderTop: '1px solid #eee',
            textAlign: 'center',
            color: '#888',
            fontSize: 12,
          }}
        >
          <p style={{ margin: '0 0 6px 0' }}>
            Questions or changes? <strong>Text us at {TEXT_NUMBER}</strong> and we&apos;ll help.
          </p>
          <p style={{ margin: 0 }}>Sasquatch Carpet Cleaning · Colorado Springs, CO</p>
        </div>
      </div>
    </div>
  )
}

export default async function EstimateDecisionPage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params
  const result = await loadEstimate(decodeURIComponent(token))

  if (!result.ok) {
    return (
      <Shell>
        <h1 style={{ fontSize: 20, margin: '0 0 12px 0' }}>{result.title}</h1>
        <p style={{ margin: 0, lineHeight: 1.6 }}>{result.message}</p>
      </Shell>
    )
  }

  return (
    <Shell>
      <h1 style={{ fontSize: 20, margin: '0 0 4px 0' }}>
        {result.customerName ? `Hi ${result.customerName},` : 'Your estimate'}
      </h1>
      <p style={{ margin: '0 0 20px 0', lineHeight: 1.6 }}>
        Here&apos;s your estimate from Sasquatch Carpet Cleaning
        {result.address ? ` for ${result.address}` : ''}.
      </p>

      {result.lines.length === 0 ? (
        <p style={{ lineHeight: 1.6 }}>
          This estimate doesn&apos;t have any line items yet. Please text us at{' '}
          {TEXT_NUMBER}.
        </p>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 20 }}>
          <tbody>
            {result.lines.map((line, i) => (
              <tr key={i} style={{ borderBottom: '1px solid #eee' }}>
                <td style={{ padding: '12px 0', verticalAlign: 'top' }}>
                  <div style={{ fontWeight: 600 }}>{line.name}</div>
                  {line.qtyLabel ? (
                    <div style={{ color: '#666', fontSize: 13, marginTop: 2 }}>
                      {line.qtyLabel} × {money(line.unitPrice)}
                    </div>
                  ) : null}
                  {line.breakdown ? (
                    <div style={{ color: '#888', fontSize: 12, marginTop: 2 }}>
                      {line.breakdown}
                    </div>
                  ) : null}
                  {line.notes ? (
                    <div style={{ color: '#666', fontSize: 13, marginTop: 6, lineHeight: 1.5 }}>
                      {line.notes}
                    </div>
                  ) : null}
                </td>
                <td
                  style={{
                    padding: '12px 0',
                    textAlign: 'right',
                    verticalAlign: 'top',
                    whiteSpace: 'nowrap',
                    fontWeight: 600,
                  }}
                >
                  {money(line.lineTotal)}
                </td>
              </tr>
            ))}
            <tr>
              <td style={{ padding: '16px 0', fontSize: 18, fontWeight: 700 }}>
                Estimated total
              </td>
              <td
                style={{
                  padding: '16px 0',
                  textAlign: 'right',
                  fontSize: 18,
                  fontWeight: 700,
                  color: ACCENT,
                }}
              >
                {money(result.total)}
              </td>
            </tr>
          </tbody>
        </table>
      )}

      <EstimateDecision
        token={result.token}
        initialStatus={result.status}
        locked={result.locked}
        textNumber={TEXT_NUMBER}
      />

      <p style={{ color: '#888', fontSize: 12, lineHeight: 1.6, marginTop: 24, marginBottom: 0 }}>
        This estimate reflects our standard pricing for the areas and services listed
        above. All of our work is backed by our satisfaction guarantee — if it&apos;s not
        right, we&apos;ll make it right.
      </p>
    </Shell>
  )
}
