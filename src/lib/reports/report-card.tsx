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

const CHART_HEIGHT = 240
const MIN_BAR_HEIGHT = 3

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

function BarChart({ series }: { series: ReportCardSeries }) {
  const values = series.points.map((point) => point.value)
  const max = Math.max(...values, 1)
  const peak = Math.max(...values)
  const lastIndex = series.points.length - 1

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
        style={{
          display: 'flex',
          alignItems: 'flex-end',
          justifyContent: 'space-between',
          height: CHART_HEIGHT,
          marginTop: 18,
        }}
      >
        {series.points.map((point, index) => {
          const isCurrent = index === lastIndex
          const isPeak = point.value === peak && !isCurrent
          const barColor = isCurrent
            ? '#38bdf8'
            : isPeak
              ? '#475f85'
              : COLORS.panelEdge
          const barHeight = Math.max(
            MIN_BAR_HEIGHT,
            Math.round((point.value / max) * (CHART_HEIGHT - 70)),
          )
          return (
            <div
              key={`${point.label}-${index}`}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'flex-end',
                width: 84,
              }}
            >
              <div
                style={{
                  display: 'flex',
                  fontSize: 24,
                  marginBottom: 8,
                  color: isCurrent ? '#7dd3fc' : COLORS.textMuted,
                }}
              >
                {point.value}
              </div>
              <div
                style={{
                  display: 'flex',
                  width: 52,
                  height: barHeight,
                  backgroundColor: barColor,
                  borderRadius: 6,
                }}
              />
              <div
                style={{
                  display: 'flex',
                  fontSize: 17,
                  marginTop: 10,
                  color: isCurrent ? COLORS.textMuted : COLORS.textFaint,
                }}
              >
                {point.label}
              </div>
            </div>
          )
        })}
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
          <BarChart series={input.series} />
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
