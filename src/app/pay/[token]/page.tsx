import Link from 'next/link'
import { unstable_noStore as noStore } from 'next/cache'
import type { ReactNode } from 'react'
import { createAdminClient } from '@/supabase/server'
import { createSquarePaymentLink } from '@/lib/payments/square'
import { buildVenmoPaymentLink } from '@/lib/payments/venmo'
import {
  PaymentLinkTokenError,
  type PaymentLinkProvider,
  verifyInvoicePaymentToken,
} from '@/lib/payments/signed-payment-link'

const VENMO_USERNAME = process.env.VENMO_BUSINESS_USERNAME ?? 'SasquatchCarpet'

type PaymentDestination =
  | {
      ok: true
      amount: number
      invoiceNumber: number
      provider: PaymentLinkProvider
      targetUrl: string
    }
  | {
      ok: false
      title: string
      message: string
    }

function unwrapRelation<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null
  return Array.isArray(value) ? value[0] || null : value
}

async function loadPaymentDestination(
  token: string,
): Promise<PaymentDestination> {
  noStore()
  let verified: ReturnType<typeof verifyInvoicePaymentToken>
  try {
    verified = verifyInvoicePaymentToken(token)
  } catch (error) {
    if (error instanceof PaymentLinkTokenError) {
      return {
        ok: false,
        title:
          error.code === 'expired'
            ? 'Payment Link Expired'
            : 'Payment Link Unavailable',
        message:
          error.code === 'expired'
            ? 'This invoice payment link has expired. Please call or text Sasquatch Carpet Cleaning for a fresh link.'
            : 'This payment link could not be verified. Please call or text Sasquatch Carpet Cleaning for help.',
      }
    }
    throw error
  }

  const supabase = createAdminClient()
  const { data: invoice, error } = await supabase
    .from('ops_invoices')
    .select(
      `
        id,
        invoice_number,
        total,
        ops_appointments (
          id,
          ops_customers!ops_appointments_customer_id_fkey (
            full_name,
            business_name
          )
        )
      `,
    )
    .eq('id', verified.invoiceId)
    .single()

  if (error || !invoice) {
    return {
      ok: false,
      title: 'Invoice Not Found',
      message:
        'We could not find this invoice. Please call or text Sasquatch Carpet Cleaning for help.',
    }
  }

  const invoiceNumber = Number(invoice.invoice_number || 0)
  const amount = Number(invoice.total || 0)
  if (!invoiceNumber || !Number.isFinite(amount) || amount <= 0) {
    return {
      ok: false,
      title: 'Payment Link Unavailable',
      message:
        'This invoice is not ready for online payment. Please call or text Sasquatch Carpet Cleaning for help.',
    }
  }

  const appointment = unwrapRelation(invoice.ops_appointments)
  const customer = unwrapRelation(appointment?.ops_customers)
  const customerName =
    customer?.business_name || customer?.full_name || 'Valued Customer'

  try {
    const targetUrl =
      verified.provider === 'square'
        ? await createSquarePaymentLink({
            invoiceId: verified.invoiceId,
            invoiceNumber,
            amount,
            customerName,
            description: `Invoice #${invoiceNumber}`,
          })
        : buildVenmoPaymentLink({
            username: VENMO_USERNAME,
            invoiceNumber,
            amount,
            customerName,
          })

    return {
      ok: true,
      amount,
      invoiceNumber,
      provider: verified.provider,
      targetUrl,
    }
  } catch (error) {
    console.error('[pay/:token] Payment destination failed:', error)
    return {
      ok: false,
      title: 'Payment Link Unavailable',
      message:
        'The payment provider did not return a usable link. Please call or text Sasquatch Carpet Cleaning for help.',
    }
  }
}

function PaymentShell({
  children,
  title,
}: {
  children: ReactNode
  title: string
}) {
  return (
    <main className="min-h-screen bg-[#08252b] px-5 py-10 text-slate-950">
      <div className="mx-auto flex min-h-[calc(100vh-5rem)] max-w-lg items-center">
        <section className="w-full rounded-lg border border-emerald-900/10 bg-white p-6 shadow-2xl shadow-black/25">
          <p className="text-sm font-semibold tracking-wide text-emerald-700">
            Sasquatch Carpet Cleaning
          </p>
          <h1 className="mt-3 text-2xl font-bold text-slate-950">{title}</h1>
          {children}
        </section>
      </div>
    </main>
  )
}

export default async function PaymentPage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params
  const destination = await loadPaymentDestination(token)

  if (!destination.ok) {
    return (
      <PaymentShell title={destination.title}>
        <p className="mt-3 text-sm leading-6 text-slate-700">
          {destination.message}
        </p>
        <Link
          href="/"
          className="mt-6 inline-flex w-full items-center justify-center rounded-md bg-emerald-700 px-4 py-3 text-sm font-semibold text-white hover:bg-emerald-800"
        >
          Return to Sasquatch
        </Link>
      </PaymentShell>
    )
  }

  const providerLabel =
    destination.provider === 'square' ? 'Square Pay' : 'Venmo'

  return (
    <PaymentShell title={`Continue to ${providerLabel}`}>
      <p className="mt-3 text-sm leading-6 text-slate-700">
        Invoice #{destination.invoiceNumber} is ready for payment. The total due
        is ${destination.amount.toFixed(2)}.
      </p>
      <a
        href={destination.targetUrl}
        rel="nofollow"
        className="mt-6 inline-flex w-full items-center justify-center rounded-md bg-emerald-700 px-4 py-3 text-sm font-semibold text-white hover:bg-emerald-800"
      >
        Continue to {providerLabel}
      </a>
      <p className="mt-4 text-xs leading-5 text-slate-500">
        You are leaving the Sasquatch Carpet Cleaning payment page to complete
        payment with {providerLabel}.
      </p>
      <script
        dangerouslySetInnerHTML={{
          __html: `window.setTimeout(function(){ window.location.href = ${JSON.stringify(
            destination.targetUrl,
          )}; }, 900);`,
        }}
      />
    </PaymentShell>
  )
}
