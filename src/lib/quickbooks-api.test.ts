import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/quickbooks-auth', () => ({
  getValidQBAccessToken: vi.fn(async () => ({
    accessToken: 'access-token',
    realmId: 'realm-id',
  })),
  getQBConnectionStatus: vi.fn(),
}))

vi.mock('@/supabase/server', () => ({
  createAdminClient: vi.fn(),
}))

import { createQBInvoice } from './quickbooks-api'

const params = {
  qbCustomerId: '724',
  serviceDate: '2026-07-28',
  lineItems: [
    {
      description: '',
      quantity: 1,
      unit_price: 298,
      line_total: 298,
    },
  ],
  docNumber: 18311,
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      intuit_tid: 'duplicate-race-test',
    },
  })
}

describe('createQBInvoice', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('recovers when another worker creates the same invoice during the request', async () => {
    let queryCount = 0
    const fetchMock = vi.fn(
      async (input: string | URL | Request, _init?: RequestInit) => {
        const url = String(input)
        if (url.includes('/query?')) {
          queryCount++
          if (queryCount === 1) {
            return jsonResponse({ QueryResponse: {} })
          }
          return jsonResponse({
            QueryResponse: {
              Invoice: [
                {
                  Id: '6254',
                  DocNumber: '18311',
                  CustomerRef: { value: '724', name: 'Charlie Hayes' },
                  TxnDate: '2026-07-28',
                  TotalAmt: 298,
                },
              ],
            },
          })
        }

        return jsonResponse(
          {
            Fault: {
              Error: [
                {
                  Message: 'Duplicate Document Number Error',
                  Detail:
                    'DocNumber=18311 is assigned to TxnType=Invoice with TxnId=6254',
                  code: '6140',
                },
              ],
            },
          },
          400,
        )
      },
    )
    vi.stubGlobal('fetch', fetchMock)

    await expect(createQBInvoice(params)).resolves.toBe('6254')
    expect(queryCount).toBe(2)
    expect(
      fetchMock.mock.calls.filter(([, options]) => options?.method === 'POST'),
    ).toHaveLength(1)
  })

  it('still rejects a document number that belongs to a different invoice', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        QueryResponse: {
          Invoice: [
            {
              Id: '6000',
              DocNumber: '18311',
              CustomerRef: { value: '999', name: 'Another Customer' },
              TxnDate: '2026-07-27',
              TotalAmt: 125,
            },
          ],
        },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    await expect(createQBInvoice(params)).rejects.toThrow(
      '18311 already belongs to Another Customer',
    )
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
