import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CustomerDeleteControl } from './customer-delete-control'

const preview = {
  customer: {
    id: 'customer-a',
    label: 'Sasquatch Carpet Cleaning',
    fullName: 'Charles Sewell',
    phone: '+17195550123',
    email: 'charles@example.com',
    quickbooksCustomerId: '567',
  },
  blocking: [
    { key: 'appointments', label: 'appointments and estimates', count: 0 },
  ],
  removed: [{ key: 'addresses', label: 'service addresses', count: 2 }],
  detached: [{ key: 'email_log', label: 'email history', count: 5 }],
  canDelete: true,
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('CustomerDeleteControl', () => {
  it('previews impact and requires explicit confirmation', async () => {
    const user = userEvent.setup()
    const onDeleted = vi.fn()
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ preview }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            deleted: {
              id: 'customer-a',
              label: 'Sasquatch Carpet Cleaning',
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      )

    render(
      <CustomerDeleteControl
        customerId="customer-a"
        label="Sasquatch Carpet Cleaning"
        onDeleted={onDeleted}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Delete' }))
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText('2 service addresses')).toBeInTheDocument()
    expect(
      screen.getByText('Retained but disconnected: 5 email history.'),
    ).toBeInTheDocument()
    expect(
      screen.getByText('The QuickBooks customer is not deleted.'),
    ).toBeInTheDocument()

    const deleteButton = screen.getByRole('button', {
      name: 'Delete customer permanently',
    })
    expect(deleteButton).toBeDisabled()
    await user.type(screen.getByLabelText('Type DELETE to confirm'), 'DELETE')
    expect(deleteButton).toBeEnabled()
    await user.click(deleteButton)

    expect(fetchMock).toHaveBeenLastCalledWith(
      '/api/admin/ops/customers/customer-a/deletion',
      expect.objectContaining({ method: 'DELETE' }),
    )
    expect(onDeleted).toHaveBeenCalledWith('customer-a')
  })

  it('explains why protected customers cannot be deleted', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          preview: {
            ...preview,
            blocking: [
              {
                key: 'appointments',
                label: 'appointments and estimates',
                count: 3,
              },
            ],
            canDelete: false,
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    )

    render(
      <CustomerDeleteControl
        customerId="customer-a"
        label="Protected customer"
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }))

    expect(
      await screen.findByText('Deletion is blocked to protect history.'),
    ).toBeInTheDocument()
    expect(
      screen.queryByLabelText('Type DELETE to confirm'),
    ).not.toBeInTheDocument()
  })
})
