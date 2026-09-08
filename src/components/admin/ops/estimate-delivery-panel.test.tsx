import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { EstimateDeliveryPanel } from './estimate-delivery-panel'

function setup(
  overrides: Partial<React.ComponentProps<typeof EstimateDeliveryPanel>> = {},
) {
  const onSend = vi
    .fn()
    .mockResolvedValue({ to_email: 'customer@example.com', warning: null })
  render(
    <EstimateDeliveryPanel
      status="accepted"
      converted={false}
      email="customer@example.com"
      total={1049.94}
      blockedReason={null}
      busy={false}
      lastEmail={null}
      historyUnavailable={false}
      onSend={onSend}
      {...overrides}
    />,
  )
  return onSend
}

describe('estimate delivery panel', () => {
  it('shows recipient and total before requiring explicit reopening with a reason', async () => {
    const onSend = setup()
    expect(screen.getByText('customer@example.com')).toBeInTheDocument()
    expect(screen.getByText('$1049.94')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Reopen & resend' }))
    expect(onSend).not.toHaveBeenCalled()
    expect(screen.getByText(/Accepted to Sent/)).toBeInTheDocument()
    const confirm = screen.getByRole('button', {
      name: 'Confirm reopen & send',
    })
    expect(confirm).toBeDisabled()
    fireEvent.change(
      screen.getByLabelText('Reason for reopening (required, internal only)'),
      { target: { value: ' Customer disputes approval ' } },
    )
    fireEvent.click(confirm)
    await waitFor(() => expect(onSend).toHaveBeenCalledOnce())
    expect(onSend).toHaveBeenCalledWith({
      reopen: true,
      reason: 'Customer disputes approval',
      request_id: expect.any(String),
    })
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Estimate email sent to customer@example.com',
    )
  })
  it('cancel does not send or change anything', () => {
    const onSend = setup()
    fireEvent.click(screen.getByRole('button', { name: 'Reopen & resend' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(
      screen.queryByText('Confirm reopen and resend'),
    ).not.toBeInTheDocument()
    expect(onSend).not.toHaveBeenCalled()
  })
  it.each([
    ['draft', 'Send estimate'],
    ['sent', 'Resend estimate'],
  ])('labels a %s estimate clearly', (status, action) => {
    setup({ status })
    fireEvent.click(screen.getByRole('button', { name: action }))
    expect(
      screen.getByRole('button', { name: 'Confirm & send email' }),
    ).toBeEnabled()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })
  it('shows last recorded sending without claiming receipt or approval', () => {
    setup({
      status: 'sent',
      lastEmail: {
        to_email: 'previous@example.com',
        sent_at: '2026-09-08T21:04:00Z',
      },
    })
    expect(screen.getByText(/Last estimate email sent/)).toHaveTextContent(
      'previous@example.com',
    )
    expect(
      screen.getByText(/does not confirm the customer read or approved/),
    ).toBeInTheDocument()
  })
  it('explains why sending is unavailable', () => {
    setup({ email: '', blockedReason: 'Add an email address first.' })
    expect(
      screen.getByRole('button', { name: 'Reopen & resend' }),
    ).toBeDisabled()
    expect(screen.getByText('Add an email address first.')).toBeInTheDocument()
  })
  it('does not offer reopening on converted jobs', () => {
    setup({ converted: true })
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.getByText(/Already converted to a job/)).toBeInTheDocument()
  })
  it('blocks repeat clicks and keeps post-send warnings visible', async () => {
    let finish!: (value: { to_email: string; warning: string }) => void
    const onSend = vi.fn().mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    setup({ status: 'sent', onSend })
    fireEvent.click(screen.getByRole('button', { name: 'Resend estimate' }))
    fireEvent.click(
      screen.getByRole('button', { name: 'Confirm & send email' }),
    )
    expect(screen.getByRole('button', { name: 'Sending…' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Sending…' }))
    expect(onSend).toHaveBeenCalledOnce()
    await act(async () =>
      finish({
        to_email: 'customer@example.com',
        warning: 'Email was sent but history could not be saved.',
      }),
    )
    expect(screen.getByRole('status')).toHaveTextContent(
      'history could not be saved',
    )
  })
  it('keeps a retry on the same operation after a failure', async () => {
    const onSend = vi
      .fn()
      .mockRejectedValueOnce(new Error('Save failed. No email was sent.'))
      .mockResolvedValue({ to_email: 'customer@example.com', warning: null })
    setup({ status: 'sent', onSend })
    fireEvent.click(screen.getByRole('button', { name: 'Resend estimate' }))
    fireEvent.click(
      screen.getByRole('button', { name: 'Confirm & send email' }),
    )
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'No email was sent',
    )
    fireEvent.click(
      screen.getByRole('button', { name: 'Confirm & send email' }),
    )
    await screen.findByRole('status')
    expect(onSend.mock.calls[0][0].request_id).toBe(
      onSend.mock.calls[1][0].request_id,
    )
  })
})
