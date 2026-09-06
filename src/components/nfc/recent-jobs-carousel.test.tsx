import { createElement } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RecentJobsCarousel } from './recent-jobs-carousel'

vi.mock('next/image', () => ({
  default: ({ src, alt }: { src: string; alt: string }) =>
    createElement('img', { src, alt }),
}))

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

function mockJobs() {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(
      JSON.stringify({
        success: true,
        jobs: [
          {
            id: '1',
            title: 'First job',
            description: 'Clean carpet',
            city: 'Monument',
            image_url: '/first.jpg',
            service_type: 'Carpet cleaning',
          },
          {
            id: '2',
            title: 'Second job',
            description: 'Clean upholstery',
            city: 'Black Forest',
            image_url: '/second.jpg',
            service_type: 'Upholstery',
          },
        ],
      }),
    ),
  )
}

describe('recent work on the NFC card', () => {
  it('uses previous/next controls without a row of tiny dots in compact mode', async () => {
    mockJobs()
    render(<RecentJobsCarousel compact />)
    await screen.findByRole('heading', { name: 'First job' })
    expect(
      screen.queryByRole('button', { name: 'Go to slide 1' }),
    ).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Next job' }))
    expect(
      screen.getByRole('heading', { name: 'Second job' }),
    ).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Previous job' }))
    expect(
      screen.getByRole('heading', { name: 'First job' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: 'View All Our Work' }),
    ).toHaveAttribute('href', '/')
  })

  it('retains the existing dot navigation on other pages', async () => {
    mockJobs()
    render(<RecentJobsCarousel />)
    fireEvent.click(
      await screen.findByRole('button', { name: 'Go to slide 2' }),
    )
    expect(
      screen.getByRole('heading', { name: 'Second job' }),
    ).toBeInTheDocument()
  })
})
