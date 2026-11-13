'use client'

import { useEffect, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import { Map, Truck, X } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { trackerStatus, type FleetTracker } from '@/lib/fleet-tracking'
import { BOX_TRUCK_NAME } from '@/lib/truck-temperature'
import { Button } from '@/components/ui/button'
import styles from './schedule-dispatch-panel.module.css'

const VehicleMap = dynamic(() => import('../fleet-tracker-dashboard'), {
  ssr: false,
  loading: () => <p className="p-6 text-slate-300">Loading vehicle map…</p>,
})

function BoxTruckTravelStatus() {
  const { data, dataUpdatedAt, isError } = useQuery({
    queryKey: ['fleet-travel-status'],
    queryFn: async (): Promise<{
      trackers: FleetTracker[]
      hangingDoors?: boolean
    }> => {
      const response = await fetch('/api/admin/fleet/trackers?activity=1', {
        cache: 'no-store',
      })
      if (!response.ok) throw new Error('Vehicle status unavailable')
      return response.json()
    },
    refetchInterval: 10_000,
    retry: false,
  })
  const tracker = data?.trackers.find((item) => item.name === BOX_TRUCK_NAME)
  if (!tracker) return null
  const status = isError
    ? 'Status unavailable'
    : trackerStatus(tracker, dataUpdatedAt)
  return (
    <span
      role="status"
      className="border-border bg-background/55 inline-flex min-h-8 items-center gap-1.5 rounded-lg border px-2 text-xs"
    >
      <Truck
        aria-hidden="true"
        className={`h-3.5 w-3.5 ${status === 'Moving' ? 'text-emerald-500' : 'text-muted-foreground'}`}
      />
      <span>
        {data?.hangingDoors && !isError
          ? 'David · Hanging door flyers'
          : 'David’s box truck'}
      </span>
      <span className="text-muted-foreground">· {status}</span>
    </span>
  )
}

export function ScheduleDispatchPanel({
  day,
  staffFilter = null,
  showTravelStatus = false,
}: {
  day: string
  staffFilter?: string | null
  showTravelStatus?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [visible, setVisible] = useState(false)
  const [mounted, setMounted] = useState(false)
  const dialog = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const panel = dialog.current
    if (!panel) return
    let firstFrame = 0
    let secondFrame = 0
    let closeTimer: ReturnType<typeof setTimeout> | undefined
    if (open) {
      panel.showModal()
      const content = panel.querySelector<HTMLElement>('[data-dispatch-scroll]')
      if (content) content.scrollTop = 0
      firstFrame = requestAnimationFrame(() => {
        secondFrame = requestAnimationFrame(() => setVisible(true))
      })
    } else if (panel.open) {
      closeTimer = setTimeout(
        () => {
          panel.close()
          setMounted(false)
        },
        window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 250,
      )
    }
    return () => {
      cancelAnimationFrame(firstFrame)
      cancelAnimationFrame(secondFrame)
      clearTimeout(closeTimer)
    }
  }, [open])

  const closePanel = () => {
    setVisible(false)
    setOpen(false)
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        className="h-11 gap-2 rounded-xl border-emerald-400/40 px-4 font-semibold"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls="schedule-dispatch-map"
        onClick={() => {
          setMounted(true)
          setOpen(true)
        }}
      >
        <Map className="h-5 w-5 text-emerald-500" />
        Map
      </Button>
      {showTravelStatus && <BoxTruckTravelStatus />}
      <dialog
        ref={dialog}
        id="schedule-dispatch-map"
        aria-labelledby="schedule-dispatch-title"
        aria-describedby="schedule-dispatch-description"
        className={styles.panel}
        data-visible={visible}
        onCancel={(event) => {
          event.preventDefault()
          closePanel()
        }}
        onClose={closePanel}
        onClick={(event) => {
          if (event.target === event.currentTarget) closePanel()
        }}
      >
        <div className="flex min-h-0 flex-1 flex-col">
          <header className="shrink-0 border-b border-white/10 bg-slate-950/90 p-4 sm:p-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold tracking-[0.2em] text-emerald-300 uppercase">
                  Operations
                </p>
                <h2
                  id="schedule-dispatch-title"
                  className="mt-1 text-xl font-semibold text-white"
                >
                  Live dispatch map
                </h2>
                <p
                  id="schedule-dispatch-description"
                  className="mt-1 text-sm text-slate-400"
                >
                  Close the map to return to your calendar.
                </p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                autoFocus
                aria-label="Close dispatch map"
                onClick={closePanel}
                className="h-11 w-11 shrink-0 text-white hover:bg-white/10"
              >
                <X className="h-5 w-5" />
              </Button>
            </div>
          </header>
          <div
            data-dispatch-scroll
            className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 pb-[max(1rem,env(safe-area-inset-bottom))] text-white sm:p-5"
          >
            {mounted ? (
              <VehicleMap
                key={`${day}:${staffFilter}`}
                embedded
                day={day}
                staffFilter={staffFilter}
              />
            ) : null}
          </div>
        </div>
      </dialog>
    </>
  )
}
