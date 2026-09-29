import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireClientManager: vi.fn(),
  maybeSingle: vi.fn(),
  download: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  requireClientManager: mocks.requireClientManager,
}))

const query = {
  select: vi.fn(() => query),
  eq: vi.fn(() => query),
  maybeSingle: mocks.maybeSingle,
}
const db = {
  from: vi.fn(() => query),
  storage: { from: vi.fn(() => ({ download: mocks.download })) },
}
vi.mock('@/supabase/server', () => ({ createAdminClient: () => db }))

import { GET } from './route'

describe('commercial portal document download', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireClientManager.mockResolvedValue({
      client: { customer_id: 'customer-a' },
    })
    mocks.maybeSingle.mockResolvedValue({
      data: {
        filename: 'Sasquatch-Carpet-Cleaning-W9-2026.pdf',
        mime_type: 'application/pdf',
        storage_bucket: 'commercial-documents',
        storage_path: 'customer-a/w9.pdf',
      },
      error: null,
    })
    mocks.download.mockResolvedValue({
      data: {
        arrayBuffer: vi
          .fn()
          .mockResolvedValue(new Uint8Array([37, 80, 68, 70]).buffer),
      },
      error: null,
    })
  })

  it('scopes the document to the signed-in customer and serves it privately', async () => {
    const response = await GET(
      new NextRequest(
        'https://example.com/api/client/commercial/documents/document-a?download=1',
      ),
      { params: Promise.resolve({ id: 'document-a' }) },
    )

    expect(response.status).toBe(200)
    expect(query.eq).toHaveBeenNthCalledWith(1, 'id', 'document-a')
    expect(query.eq).toHaveBeenNthCalledWith(2, 'customer_id', 'customer-a')
    expect(db.storage.from).toHaveBeenCalledWith('commercial-documents')
    expect(mocks.download).toHaveBeenCalledWith('customer-a/w9.pdf')
    expect(response.headers.get('content-type')).toBe('application/pdf')
    expect(response.headers.get('content-disposition')).toBe(
      'attachment; filename="Sasquatch-Carpet-Cleaning-W9-2026.pdf"',
    )
    expect(response.headers.get('cache-control')).toBe('private, no-store')
  })

  it('does not expose another customer document', async () => {
    mocks.maybeSingle.mockResolvedValue({ data: null, error: null })
    const response = await GET(
      new NextRequest(
        'https://example.com/api/client/commercial/documents/document-b',
      ),
      { params: Promise.resolve({ id: 'document-b' }) },
    )

    expect(response.status).toBe(404)
    expect(mocks.download).not.toHaveBeenCalled()
  })

  it('requires an active client manager', async () => {
    mocks.requireClientManager.mockRejectedValue(
      new Error('Not a client manager'),
    )
    const response = await GET(
      new NextRequest(
        'https://example.com/api/client/commercial/documents/document-a',
      ),
      { params: Promise.resolve({ id: 'document-a' }) },
    )

    expect(response.status).toBe(403)
    expect(db.from).not.toHaveBeenCalled()
  })
})
