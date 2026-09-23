/**
 * Renders a portrait "report card" PNG for Telegram.
 *
 * Deliberately generic: any weekly report (Google Search, marketing rollup,
 * Radar rank digest) can hand over a headline verdict, up to four metric tiles
 * and one weekly series, and get back an image sized for a phone screen.
 *
 * Two constraints shape the design:
 *  - next/og bundles only Noto Sans **regular**, so hierarchy comes from size,
 *    colour and letter-spacing rather than bold weights.
 *  - Satori fetches emoji from a remote CDN, so the image uses none. Emoji stay
 *    in the accompanying text message where Telegram renders them natively.
 */

import { ImageResponse } from 'next/og'

export type ReportCardTone = 'good' | 'warn' | 'bad' | 'neutral'

export type ReportCardMetric = {
  label: string
  value: string
  note?: string
  tone?: ReportCardTone
}

export type ReportCardSeries = {
  label: string
  points: Array<{ label: string; value: number }>
  /** Keep comparable fixed-scale charts from visually exaggerating a peak. */
  maxValue?: number
}

export type ReportCardInput = {
  eyebrow: string
  title: string
  subtitle?: string | null
  verdict?: { text: string; tone: ReportCardTone } | null
  metrics: ReportCardMetric[]
  series?: ReportCardSeries | null
  footer?: string | null
}

const WIDTH = 900
const HEIGHT = 1340

const COLORS = {
  background: '#0a1120',
  panel: '#131d31',
  panelEdge: '#1f2b45',
  textPrimary: '#f1f5f9',
  textMuted: '#8ea0bd',
  textFaint: '#5c6d8a',
} as const

const TONES: Record<ReportCardTone, { accent: string; tint: string }> = {
  good: { accent: '#34d399', tint: 'rgba(52, 211, 153, 0.18)' },
  warn: { accent: '#fbbf24', tint: 'rgba(251, 191, 36, 0.18)' },
  bad: { accent: '#f87171', tint: 'rgba(248, 113, 113, 0.18)' },
  neutral: { accent: '#94a3b8', tint: 'rgba(148, 163, 184, 0.14)' },
}

const CHART_WIDTH = 800
const CHART_HEIGHT = 285
const CHART_MARGIN = { top: 18, right: 20, bottom: 52, left: 58 }

function MetricTile({ metric }: { metric: ReportCardMetric }) {
  const tone = TONES[metric.tone ?? 'neutral']
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: 380,
        padding: '24px 26px',
        backgroundColor: COLORS.panel,
        border: `1px solid ${COLORS.panelEdge}`,
        borderRadius: 18,
      }}
    >
      <div
        style={{
          display: 'flex',
          fontSize: 20,
          letterSpacing: 1.4,
          textTransform: 'uppercase',
          color: COLORS.textMuted,
        }}
      >
        {metric.label}
      </div>
      <div
        style={{
          display: 'flex',
          fontSize: 68,
          lineHeight: 1.1,
          marginTop: 10,
          color: COLORS.textPrimary,
        }}
      >
        {metric.value}
      </div>
      {metric.note ? (
        <div
          style={{
            display: 'flex',
            fontSize: 22,
            marginTop: 8,
            color: tone.accent,
          }}
        >
          {metric.note.replace(/\.$/, '')}
        </div>
      ) : null}
    </div>
  )
}

function LineChart({ series }: { series: ReportCardSeries }) {
  const values = series.points.map((point) => point.value)
  const max = Math.max(series.maxValue ?? 0, ...values, 1)
  const plotWidth = CHART_WIDTH - CHART_MARGIN.left - CHART_MARGIN.right
  const plotHeight = CHART_HEIGHT - CHART_MARGIN.top - CHART_MARGIN.bottom
  const xFor = (index: number) =>
    CHART_MARGIN.left +
    (series.points.length === 1
      ? plotWidth / 2
      : (index / (series.points.length - 1)) * plotWidth)
  const yFor = (value: number) =>
    CHART_MARGIN.top + plotHeight - (value / max) * plotHeight
  const linePath = series.points
    .map(
      (point, index) =>
        `${index === 0 ? 'M' : 'L'} ${xFor(index).toFixed(1)} ${yFor(point.value).toFixed(1)}`,
    )
    .join(' ')
  const areaPath =
    `${linePath} ` +
    `L ${xFor(series.points.length - 1).toFixed(1)} ${(CHART_MARGIN.top + plotHeight).toFixed(1)} ` +
    `L ${xFor(0).toFixed(1)} ${(CHART_MARGIN.top + plotHeight).toFixed(1)} Z`
  const integerScale = Number.isInteger(max) && max <= 10
  const yTicks = integerScale
    ? Array.from({ length: max + 1 }, (_, index) => index)
    : [0, max / 2, max]
  const labelEvery = Math.max(1, Math.ceil(series.points.length / 7))

  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <div
        style={{
          display: 'flex',
          fontSize: 20,
          letterSpacing: 1.4,
          textTransform: 'uppercase',
          color: COLORS.textMuted,
        }}
      >
        {series.label}
      </div>
      <div
        role="img"
        aria-label={`${series.label} line graph`}
        style={{
          display: 'flex',
          position: 'relative',
          width: CHART_WIDTH,
          height: CHART_HEIGHT,
          marginTop: 12,
        }}
      >
        <svg
          width={CHART_WIDTH}
          height={CHART_HEIGHT}
          viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
          style={{ position: 'absolute', left: 0, top: 0 }}
        >
          {yTicks.map((tick) => {
            const y = yFor(tick)
            return (
              <line
                key={`grid-${tick}`}
                x1={CHART_MARGIN.left}
                y1={y}
                x2={CHART_WIDTH - CHART_MARGIN.right}
                y2={y}
                stroke={COLORS.panelEdge}
                strokeWidth={2}
              />
            )
          })}

          <line
            x1={CHART_MARGIN.left}
            y1={CHART_MARGIN.top}
            x2={CHART_MARGIN.left}
            y2={CHART_MARGIN.top + plotHeight}
            stroke={COLORS.textFaint}
            strokeWidth={2}
          />
          <line
            x1={CHART_MARGIN.left}
            y1={CHART_MARGIN.top + plotHeight}
            x2={CHART_WIDTH - CHART_MARGIN.right}
            y2={CHART_MARGIN.top + plotHeight}
            stroke={COLORS.textFaint}
            strokeWidth={2}
          />

          <path d={areaPath} fill="rgba(56, 189, 248, 0.12)" />
          <path
            d={linePath}
            fill="none"
            stroke="#38bdf8"
            strokeWidth={6}
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          {series.points.map((point, index) => {
            const isCurrent = index === series.points.length - 1
            return (
              <circle
                key={`${point.label}-${index}`}
                cx={xFor(index)}
                cy={yFor(point.value)}
                r={isCurrent ? 9 : 6}
                fill={isCurrent ? '#7dd3fc' : COLORS.background}
                stroke="#38bdf8"
                strokeWidth={4}
              />
            )
          })}
        </svg>

        {yTicks.map((tick) => (
          <div
            key={`y-${tick}`}
            style={{
              display: 'flex',
              position: 'absolute',
              left: 0,
              top: yFor(tick) - 11,
              width: CHART_MARGIN.left - 14,
              justifyContent: 'flex-end',
              fontSize: 17,
              color: COLORS.textMuted,
            }}
          >
            {Number.isInteger(tick) ? tick : tick.toFixed(1)}
          </div>
        ))}

        {series.points.map((point, index) => {
          const isCurrent = index === series.points.length - 1
          if (index % labelEvery !== 0 && !isCurrent) return null
          const labelWidth = 82
          return (
            <div
              key={`x-${point.label}-${index}`}
              style={{
                display: 'flex',
                position: 'absolute',
                left: Math.max(
                  CHART_MARGIN.left,
                  Math.min(
                    CHART_WIDTH - CHART_MARGIN.right - labelWidth,
                    xFor(index) - labelWidth / 2,
                  ),
                ),
                top: CHART_HEIGHT - 30,
                width: labelWidth,
                justifyContent:
                  index === 0
                    ? 'flex-start'
                    : isCurrent
                      ? 'flex-end'
                      : 'center',
                fontSize: 16,
                color: isCurrent ? '#7dd3fc' : COLORS.textMuted,
              }}
            >
              {point.label}
            </div>
          )
        })}

        <div
          style={{
            display: 'flex',
            position: 'absolute',
            right: CHART_MARGIN.right,
            top: Math.max(0, yFor(values[values.length - 1]) - 31),
            fontSize: 21,
            color: '#7dd3fc',
          }}
        >
          Latest: {values[values.length - 1]}
        </div>
      </div>
    </div>
  )
}

function ReportCard({ input }: { input: ReportCardInput }) {
  const tone = TONES[input.verdict?.tone ?? 'neutral']
  const rows: ReportCardMetric[][] = []
  for (let i = 0; i < input.metrics.length; i += 2) {
    rows.push(input.metrics.slice(i, i + 2))
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: WIDTH,
        height: HEIGHT,
        backgroundColor: COLORS.background,
      }}
    >
      <div
        style={{ display: 'flex', height: 10, backgroundColor: tone.accent }}
      />

      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          padding: '44px 50px 40px 50px',
          flexGrow: 1,
        }}
      >
        <div
          style={{
            display: 'flex',
            fontSize: 24,
            letterSpacing: 4,
            textTransform: 'uppercase',
            color: tone.accent,
          }}
        >
          {input.eyebrow}
        </div>
        <div
          style={{
            display: 'flex',
            fontSize: 58,
            marginTop: 10,
            color: COLORS.textPrimary,
          }}
        >
          {input.title}
        </div>
        {input.subtitle ? (
          <div
            style={{
              display: 'flex',
              fontSize: 24,
              marginTop: 8,
              color: COLORS.textMuted,
            }}
          >
            {input.subtitle}
          </div>
        ) : null}

        {input.verdict ? (
          <div
            style={{
              display: 'flex',
              marginTop: 32,
              padding: '26px 30px',
              backgroundColor: tone.tint,
              borderLeft: `8px solid ${tone.accent}`,
              borderRadius: 14,
            }}
          >
            <div
              style={{
                display: 'flex',
                fontSize: 40,
                lineHeight: 1.25,
                color: COLORS.textPrimary,
              }}
            >
              {input.verdict.text}
            </div>
          </div>
        ) : null}

        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            marginTop: 34,
          }}
        >
          {rows.map((row, rowIndex) => (
            <div
              key={rowIndex}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                marginTop: rowIndex === 0 ? 0 : 20,
              }}
            >
              {row.map((metric) => (
                <MetricTile key={metric.label} metric={metric} />
              ))}
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', flexGrow: 1 }} />

        {input.series && input.series.points.length > 0 ? (
          <LineChart series={input.series} />
        ) : null}

        {input.footer ? (
          <div
            style={{
              display: 'flex',
              fontSize: 20,
              marginTop: 30,
              color: COLORS.textMuted,
            }}
          >
            {input.footer}
          </div>
        ) : null}
      </div>
    </div>
  )
}

/** Render the card to a PNG buffer. Safe to call from a cron route. */
export async function renderReportCardPng(
  input: ReportCardInput,
): Promise<Buffer> {
  const response = new ImageResponse(<ReportCard input={input} />, {
    width: WIDTH,
    height: HEIGHT,
  })
  return Buffer.from(await response.arrayBuffer())
}
