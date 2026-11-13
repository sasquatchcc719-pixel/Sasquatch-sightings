import { connection, NextResponse } from 'next/server'
import { loadCustomerArrival } from '@/lib/ops/customer-arrival'

const headers = {
  'Cache-Control': 'private, no-store',
  'Referrer-Policy': 'no-referrer',
  'X-Robots-Tag': 'noindex, nofollow',
}

export async function GET(request: Request) {
  await connection()
  try {
    const token =
      request.headers.get('authorization')?.match(/^Bearer (.+)$/)?.[1] ?? ''
    return NextResponse.json(await loadCustomerArrival(token), { headers })
  } catch {
    return NextResponse.json({ status: 'waiting' }, { headers, status: 503 })
  }
}
