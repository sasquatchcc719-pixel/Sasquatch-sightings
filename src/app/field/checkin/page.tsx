'use client'

/**
 * Gears — maintenance-only. Meter/hours entry happens as a popup right when
 * a tech clocks in (see TechClockControl); this page is just the maintenance
 * task queue so it doesn't compete with that flow.
 */

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Check, Loader2, Wrench, X as XIcon } from 'lucide-react'

type MaintenanceTask = {
  id: string
  asset_id: string
  title: string
  status: string
  meter_at_trigger: number | null
  triggered_at: string
  asset_name: string
  meter_type: string
}

export default function CheckinPage() {
  const [tasks, setTasks] = useState<MaintenanceTask[]>([])
  const [tasksLoading, setTasksLoading] = useState(true)
  const [taskBusyId, setTaskBusyId] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/field/maintenance', { cache: 'no-store' })
      .then((r) => r.json())
      .then((data) => setTasks(data.tasks ?? []))
      .finally(() => setTasksLoading(false))
  }, [])

  const resolveTask = async (
    taskId: string,
    action: 'complete' | 'dismiss',
  ) => {
    setTaskBusyId(taskId)
    try {
      const res = await fetch('/api/field/maintenance', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId, action }),
      })
      if (res.ok) {
        setTasks((prev) => prev.filter((t) => t.id !== taskId))
      }
    } finally {
      setTaskBusyId(null)
    }
  }

  return (
    <main className="min-h-screen bg-slate-950 p-4 text-slate-100">
      <div className="mx-auto max-w-md space-y-4">
        <div className="flex items-center gap-3">
          <Link href="/field" className="text-slate-400 hover:text-white">
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <h1 className="flex items-center gap-2 text-lg font-semibold">
            <Wrench className="h-5 w-5" /> ⚙️ Gears
          </h1>
        </div>

        {tasksLoading ? (
          <p className="flex items-center gap-2 text-sm text-slate-400">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </p>
        ) : tasks.length === 0 ? (
          <p className="rounded-xl bg-white/5 p-4 text-sm text-slate-400">
            Nothing due right now. Machine hours get logged automatically when
            you clock in.
          </p>
        ) : (
          <div className="space-y-2 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3">
            <p className="flex items-center gap-2 text-sm font-semibold text-amber-300">
              <Wrench className="h-4 w-4" /> Maintenance due ({tasks.length})
            </p>
            <div className="space-y-2">
              {tasks.map((t) => (
                <div
                  key={t.id}
                  className="flex items-center gap-2 rounded-lg bg-black/20 p-2.5"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-slate-100">
                      {t.title}
                    </p>
                    <p className="text-xs text-slate-400">{t.asset_name}</p>
                  </div>
                  <button
                    type="button"
                    disabled={taskBusyId === t.id}
                    onClick={() => resolveTask(t.id, 'dismiss')}
                    title="Not now"
                    className="rounded-lg bg-white/10 p-2 hover:bg-white/20 disabled:opacity-40"
                  >
                    <XIcon className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    disabled={taskBusyId === t.id}
                    onClick={() => resolveTask(t.id, 'complete')}
                    title="Done"
                    className="rounded-lg bg-green-600 p-2 hover:bg-green-500 disabled:opacity-40"
                  >
                    {taskBusyId === t.id ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Check className="h-4 w-4" />
                    )}
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </main>
  )
}
