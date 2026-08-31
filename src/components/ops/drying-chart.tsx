'use client'

import { useMemo } from 'react'
import {
  buildDryingChart,
  dayLabel,
  type DryingSeries,
} from '@/lib/ops/restoration-drying-series'

/**
 * Readings falling toward their dry standard, over the days of the job.
 *
 * Hand-drawn SVG rather than a charting library: it is five lines and a dashed
 * rule, it has to render identically in a PDF that cannot run JavaScript, and a
 * chart library would be a dependency carried for one screen.
 */

const LINE_COLORS = [
  '#0284c7',
  '#059669',
  '#d97706',
  '#dc2626',
  '#7c3aed',
  '#0891b2',
  '#be185d',
]

const W = 640
const H = 260
const PAD = { top: 12, right: 12, bottom: 28, left: 34 }

export function DryingChart({
  points,
}: {
  points: Array<{
    id?: string
    label: string
    material: string | null
    dry_standard: number | null
    restoration_readings: Array<{ value: number | string; taken_at: string }>
  }>
}) {
  const chart = useMemo(() => buildDryingChart(points), [points])

  if (!chart.plottable) {
    return (
      <p className="text-muted-foreground text-xs">
        {chart.series.length === 0
          ? 'No readings yet.'
          : 'One day of readings so far — the chart appears on the second monitor visit.'}
      </p>
    )
  }

  const plotW = W - PAD.left - PAD.right
  const plotH = H - PAD.top - PAD.bottom
  const span = Math.max(1, chart.maxValue - chart.minValue)
  const x = (dayIndex: number) =>
    PAD.left +
    (chart.days.length === 1 ? plotW / 2 : (dayIndex / (chart.days.length - 1)) * plotW)
  const y = (value: number) =>
    PAD.top + plotH - ((value - chart.minValue) / span) * plotH

  const path = (series: DryingSeries) =>
    series.points
      .map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(p.dayIndex).toFixed(1)} ${y(p.value).toFixed(1)}`)
      .join(' ')

  // One dashed rule per distinct standard, not one per point: five points on
  // framing share a line, and five identical rules would just look like noise.
  const standards = [
    ...new Set(
      chart.series
        .map((s) => s.dryStandard)
        .filter((v): v is number => v != null && Number.isFinite(v)),
    ),
  ]

  const ticks = [chart.minValue, Math.round((chart.minValue + chart.maxValue) / 2), chart.maxValue]

  return (
    <div className="flex flex-col gap-2">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full"
        role="img"
        aria-label="Moisture readings over time"
      >
        {ticks.map((tick) => (
          <g key={`tick-${tick}`}>
            <line
              x1={PAD.left}
              x2={W - PAD.right}
              y1={y(tick)}
              y2={y(tick)}
              className="stroke-slate-300/60 dark:stroke-slate-700/60"
              strokeWidth={1}
            />
            <text
              x={PAD.left - 6}
              y={y(tick) + 3}
              textAnchor="end"
              className="fill-slate-500 text-[9px]"
            >
              {tick}%
            </text>
          </g>
        ))}

        {standards.map((standard) => (
          <line
            key={`std-${standard}`}
            x1={PAD.left}
            x2={W - PAD.right}
            y1={y(standard)}
            y2={y(standard)}
            stroke="#059669"
            strokeWidth={1.5}
            strokeDasharray="5 4"
          />
        ))}

        {chart.days.map((day, i) => (
          <text
            key={day}
            x={x(i)}
            y={H - 8}
            textAnchor="middle"
            className="fill-slate-500 text-[9px]"
          >
            {dayLabel(day)}
          </text>
        ))}

        {chart.series.map((series, i) => (
          <g key={series.id}>
            <path
              d={path(series)}
              fill="none"
              stroke={LINE_COLORS[i % LINE_COLORS.length]}
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
            {series.points.map((p) => (
              <circle
                key={`${series.id}-${p.dayIndex}`}
                cx={x(p.dayIndex)}
                cy={y(p.value)}
                r={3}
                fill={LINE_COLORS[i % LINE_COLORS.length]}
              />
            ))}
          </g>
        ))}
      </svg>

      <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
        {chart.series.map((series, i) => (
          <span key={series.id} className="flex items-center gap-1">
            <span
              className="h-2 w-3 rounded-sm"
              style={{ background: LINE_COLORS[i % LINE_COLORS.length] }}
            />
            {series.label}
          </span>
        ))}
        {standards.length > 0 ? (
          <span className="text-muted-foreground flex items-center gap-1">
            <span className="h-0 w-3 border-t-2 border-dashed border-emerald-600" />
            dry standard
          </span>
        ) : null}
      </div>
    </div>
  )
}
