import { getSearchConsoleClient, GSC_WWW_PROPERTY } from '@/lib/gsc'
import type { GscDailyRow } from '@/lib/radar-history'
/** Google-recorded impressions, distinct from a fixed-location SERP spot rank. */
export async function fetchRadarGoogleHistory(
  now = new Date(),
): Promise<GscDailyRow[]> {
  const sc = getSearchConsoleClient()
  const date = (ago: number) =>
    new Date(now.getTime() - ago * 86400000).toISOString().slice(0, 10)
  const rows = await Promise.all(
    [GSC_WWW_PROPERTY, 'https://sasquatchcarpet.com/'].map(async (siteUrl) => {
      const { data } = await sc.searchanalytics.query(
        {
          siteUrl,
          requestBody: {
            startDate: date(89),
            endDate: date(4),
            dimensions: ['date', 'query'],
            rowLimit: 25000,
            dimensionFilterGroups: [
              {
                filters: [
                  {
                    dimension: 'country',
                    operator: 'equals',
                    expression: 'usa',
                  },
                  {
                    dimension: 'device',
                    operator: 'equals',
                    expression: 'DESKTOP',
                  },
                  {
                    dimension: 'query',
                    operator: 'includingRegex',
                    expression:
                      'carpet.*(monument|palmer lake|castle rock|larkspur|colorado springs)',
                  },
                ],
              },
            ],
          },
        },
        { timeout: 15000 },
      )
      return (data.rows ?? []).map((row) => ({
        date: row.keys?.[0] ?? '',
        query: row.keys?.[1] ?? '',
        impressions: Number(row.impressions ?? 0),
        clicks: Number(row.clicks ?? 0),
        position: Number(row.position ?? 0),
      }))
    }),
  )
  return rows.flat()
}
