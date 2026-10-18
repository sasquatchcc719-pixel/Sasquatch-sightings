import { ImageResponse } from 'next/og'

export type RankHistoryPoint = {
  date: string
  rank: number | null
  status: 'ranked' | 'outside' | 'unknown'
  depth?: number
}

export type RankHistorySeries = {
  town: string
  color: string
  points: RankHistoryPoint[]
  latestLabel: string
  coverageLabel?: string
}

export type RankHistoryPanel = {
  title: string
  subtitle: string
  maxRank: number
  windowDays?: number
  intervalDays?: number
  /** Explicit bucket boundary when a weekly chart includes a partial first week. */
  startDate?: string
  series: RankHistorySeries[]
}

const WIDTH = 900
const DAY = 86_400_000
const CHART_WIDTH = 772
const CHART_HEIGHT = 280
const LEFT = 52
const RIGHT = 18
const TOP = 18
const BOTTOM = 190
const OUTSIDE_Y = 221
const MUTED = '#91a5c5'

function dateValue(date: string): number {
  return Date.parse(`${date.slice(0, 10)}T12:00:00Z`)
}

function dateLabel(value: number): string {
  return new Date(value).toLocaleDateString('en-US', {
    timeZone: 'UTC',
    month: 'short',
    day: 'numeric',
  })
}

/** Daily spacing is literal; unknown days and unmeasured gaps break the line. */
export function buildRankHistoryGeometry(
  points: RankHistoryPoint[],
  maxRank: number,
  endDate: string,
  windowDays = 30,
  intervalDays = 1,
  startDate?: string,
) {
  const end = dateValue(endDate)
  const start = startDate
    ? dateValue(startDate)
    : end - Math.max(1, windowDays - 1) * DAY
  const spanDays = Math.max(1, (end - start) / DAY)
  const xFor = (day: number) =>
    LEFT + ((day - start) / (spanDays * DAY)) * (CHART_WIDTH - LEFT - RIGHT)
  const yFor = (rank: number) =>
    TOP + ((rank - 1) / Math.max(1, maxRank - 1)) * (BOTTOM - TOP)
  const markers: Array<{ x: number; y: number; outside: boolean }> = []
  const path: string[] = []
  let previousDay: number | null = null
  let connected = false

  for (const point of [...points].sort((a, b) =>
    a.date.localeCompare(b.date),
  )) {
    const day = dateValue(point.date)
    if (!Number.isFinite(day) || day < start || day > end) continue
    const ranked =
      point.status === 'ranked' &&
      point.rank != null &&
      point.rank >= 1 &&
      point.rank <= maxRank
    const outside =
      point.status === 'outside' && (point.depth ?? maxRank) >= maxRank
    if (ranked) {
      const x = xFor(day)
      const y = yFor(point.rank!)
      const command =
        connected && previousDay === day - intervalDays * DAY ? 'L' : 'M'
      path.push(`${command} ${x.toFixed(1)} ${y.toFixed(1)}`)
      markers.push({ x, y, outside: false })
    } else if (outside) {
      markers.push({ x: xFor(day), y: OUTSIDE_Y, outside: true })
    }
    connected = ranked
    previousDay = day
  }
  return { path: path.join(' '), markers }
}

export function RankPanel({
  panel,
  endDate,
}: {
  panel: RankHistoryPanel
  endDate: string
}) {
  const end = dateValue(endDate)
  const start = panel.startDate
    ? dateValue(panel.startDate)
    : end - Math.max(1, (panel.windowDays ?? 30) - 1) * DAY
  const spanDays = Math.max(1, (end - start) / DAY)
  const xFor = (offset: number) =>
    LEFT + (offset / spanDays) * (CHART_WIDTH - LEFT - RIGHT)
  const yFor = (rank: number) =>
    TOP + ((rank - 1) / Math.max(1, panel.maxRank - 1)) * (BOTTOM - TOP)
  const ticks = [...new Set([1, 3, 5, 10, 20, 30, 50, panel.maxRank])]
    .filter((rank) => rank <= panel.maxRank)
    .sort((a, b) => a - b)
    .reduce<number[]>((visible, rank) => {
      const previous = visible.at(-1)
      if (previous == null || yFor(rank) - yFor(previous) >= 22) {
        visible.push(rank)
      } else if (rank === panel.maxRank) {
        if (previous !== 1) visible.pop()
        visible.push(rank)
      }
      return visible
    }, [])

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        padding: 22,
        backgroundColor: '#111d32',
        border: '1px solid #263754',
        borderRadius: 24,
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <div style={{ display: 'flex', fontSize: 31, color: '#f1f5ff' }}>
          {panel.title}
        </div>
        <div
          style={{
            display: 'flex',
            fontSize: 16,
            color: '#70d9ed',
            letterSpacing: 1,
          }}
        >
          #1 IS BEST
        </div>
      </div>
      <div
        style={{
          display: 'flex',
          minHeight: 54,
          marginTop: 9,
          fontSize: 20,
          lineHeight: 1.3,
          color: MUTED,
        }}
      >
        {panel.subtitle}
      </div>
      <div
        style={{
          display: 'flex',
          position: 'relative',
          width: CHART_WIDTH,
          height: CHART_HEIGHT,
          marginTop: 8,
        }}
      >
        <svg
          width={CHART_WIDTH}
          height={CHART_HEIGHT}
          viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
          style={{ position: 'absolute', left: 0, top: 0 }}
        >
          {ticks.map((tick) => (
            <line
              key={tick}
              x1={LEFT}
              y1={yFor(tick)}
              x2={CHART_WIDTH - RIGHT}
              y2={yFor(tick)}
              stroke="#293c59"
              strokeWidth={1}
            />
          ))}
          <rect
            x={LEFT}
            y={OUTSIDE_Y - 12}
            width={CHART_WIDTH - LEFT - RIGHT}
            height={24}
            rx={6}
            fill="#1d2b40"
          />
          {panel.series.map((series, seriesIndex) => {
            const geometry = buildRankHistoryGeometry(
              series.points,
              panel.maxRank,
              endDate,
              panel.windowDays,
              panel.intervalDays,
              panel.startDate,
            )
            return (
              <g key={series.town}>
                {geometry.path ? (
                  <path
                    d={geometry.path}
                    fill="none"
                    stroke={series.color}
                    strokeWidth={3.5}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                ) : null}
                {geometry.markers.map((marker, index) =>
                  marker.outside ? (
                    <path
                      key={index}
                      d={`M ${marker.x - 5} ${marker.y - 4 + (seriesIndex - (panel.series.length - 1) / 2) * 3.2} L ${marker.x + 5} ${marker.y - 4 + (seriesIndex - (panel.series.length - 1) / 2) * 3.2} L ${marker.x} ${marker.y + 5 + (seriesIndex - (panel.series.length - 1) / 2) * 3.2} Z`}
                      fill={series.color}
                    />
                  ) : (
                    <circle
                      key={index}
                      cx={marker.x}
                      cy={marker.y}
                      r={4.5}
                      fill={series.color}
                      stroke="#111d32"
                      strokeWidth={1.5}
                    />
                  ),
                )}
              </g>
            )
          })}
        </svg>
        {ticks.map((tick) => (
          <div
            key={tick}
            style={{
              display: 'flex',
              position: 'absolute',
              top: yFor(tick) - 10,
              left: 0,
              width: LEFT - 12,
              justifyContent: 'flex-end',
              fontSize: 17,
              color: MUTED,
            }}
          >
            #{tick}
          </div>
        ))}
        <div
          style={{
            display: 'flex',
            position: 'absolute',
            top: OUTSIDE_Y - 9,
            left: 0,
            fontSize: 16,
            color: MUTED,
          }}
        >{`>${panel.maxRank}`}</div>
        {[0, 1, 2, 3, 4].map((index) => {
          const offset = Math.round((index / 4) * spanDays)
          return (
            <div
              key={index}
              style={{
                display: 'flex',
                position: 'absolute',
                left: Math.min(
                  CHART_WIDTH - 80,
                  Math.max(LEFT - 16, xFor(offset) - 36),
                ),
                top: 248,
                width: 80,
                fontSize: 17,
                color: MUTED,
              }}
            >
              {dateLabel(start + offset * DAY)}
            </div>
          )
        })}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', marginTop: 6 }}>
        {panel.series.map((series) => (
          <div
            key={series.town}
            style={{
              display: 'flex',
              alignItems: 'center',
              minHeight: 30,
              marginTop: 3,
              fontSize: 18,
            }}
          >
            <div
              style={{
                display: 'flex',
                width: 11,
                height: 11,
                borderRadius: 6,
                backgroundColor: series.color,
                marginRight: 10,
              }}
            />
            <div style={{ display: 'flex', width: 192, color: '#eef4ff' }}>
              {series.town}
            </div>
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                flex: 1,
                color: MUTED,
              }}
            >
              <div style={{ display: 'flex' }}>{series.latestLabel}</div>
              {series.coverageLabel ? (
                <div style={{ display: 'flex', marginTop: 2, fontSize: 16 }}>
                  {series.coverageLabel}
                </div>
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export async function renderRankHistoryCardPng({
  date,
  panels,
  note,
}: {
  date: string
  panels: RankHistoryPanel[]
  note?: string
}): Promise<Buffer> {
  const dates = panels
    .flatMap((panel) =>
      panel.series.flatMap((series) =>
        series.points.map((point) => point.date.slice(0, 10)),
      ),
    )
    .filter((value) => Number.isFinite(dateValue(value)))
    .sort()
  const endDate = /^\d{4}-\d{2}-\d{2}$/.test(date)
    ? date
    : (dates.at(-1) ?? new Date().toISOString().slice(0, 10))
  const coverageHeight = panels.reduce(
    (sum, panel) =>
      sum + panel.series.filter((series) => series.coverageLabel).length * 22,
    0,
  )
  const height =
    310 +
    panels.length * 710 +
    Math.max(0, panels.length - 1) * 24 +
    coverageHeight
  const response = new ImageResponse(
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: WIDTH,
        height,
        backgroundColor: '#080f1d',
        padding: '38px 40px',
        color: '#f1f5ff',
      }}
    >
      <div
        style={{
          display: 'flex',
          fontSize: 19,
          letterSpacing: 4,
          color: '#70d9ed',
        }}
      >
        SASQUATCH / RADAR DAILY
      </div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginTop: 12,
        }}
      >
        <div style={{ display: 'flex', fontSize: 48 }}>
          Your Google rankings
        </div>
        <div style={{ display: 'flex', fontSize: 23, color: MUTED }}>
          {date}
        </div>
      </div>
      <div
        style={{
          display: 'flex',
          marginTop: 12,
          marginBottom: 25,
          fontSize: 21,
          color: MUTED,
        }}
      >
        Measured history · one color per town · date ranges below
      </div>
      {panels.map((panel, index) => (
        <div
          key={panel.title}
          style={{
            display: 'flex',
            flexDirection: 'column',
            marginTop: index === 0 ? 0 : 24,
          }}
        >
          <RankPanel panel={panel} endDate={endDate} />
        </div>
      ))}
      <div
        style={{
          display: 'flex',
          marginTop: 22,
          fontSize: 18,
          lineHeight: 1.35,
          color: MUTED,
        }}
      >
        Dots = measured ranks. Triangles = outside the checked range. Gaps = no
        reliable rank; no estimated positions are drawn.
      </div>
      {note ? (
        <div
          style={{
            display: 'flex',
            marginTop: 12,
            fontSize: 18,
            lineHeight: 1.35,
            color: MUTED,
          }}
        >
          {note}
        </div>
      ) : null}
    </div>,
    { width: WIDTH, height },
  )
  return Buffer.from(await response.arrayBuffer())
}
