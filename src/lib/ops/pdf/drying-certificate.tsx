import React from 'react'
import {
  Circle,
  Image,
  Line,
  Page,
  StyleSheet,
  Svg,
  Text as SvgText,
  Text,
  View,
} from '@react-pdf/renderer'
import type { DryingReportData } from '@/lib/ops/pdf/drying-report'
import {
  buildDryingCertificate,
  round1,
  type DryingCertificate,
} from '@/lib/ops/pdf/drying-certificate-data'
import { DRY_WITHIN } from '@/lib/ops/restoration-moisture'

/**
 * The certificate of drying — the single page a customer keeps and an adjuster
 * staples to the front of the claim file.
 *
 * It is a ceremonial document and it is built to look like one: framed,
 * centred, sealed, signed. Handing it over should feel like the job is
 * finished, because that is the whole point of it.
 *
 * What keeps it honest is narrow and deliberate. It states that each monitored
 * point reached the drying goal set for it — a bounded claim, against a
 * benchmark printed in the table directly below it — rather than that "the
 * structure is dry", which is unbounded, disprovable by any one reading
 * anywhere forever, and not what a moisture meter measures. When a point did
 * not reach goal it says so on the face, in the same sentence. The full terms
 * sit on the sheet behind, the way a warranty carries them; the face keeps one
 * quiet line pointing at them.
 */

const C = {
  ink: '#16242b',
  soft: '#5c757f',
  faint: '#9AA5A9',
  rule: '#0e6577',
  hair: '#D8D8D8',
  gold: '#8a6d2f',
}

const LOGO_URL = 'https://sightings.sasquatchcarpet.com/sasquatch-logo.png'

const CATEGORY_DESCRIPTOR: Record<number, string> = {
  1: 'Sanitary source',
  2: 'Significantly contaminated',
  3: 'Grossly contaminated',
}

const styles = StyleSheet.create({
  page: {
    paddingTop: 40,
    paddingBottom: 40,
    paddingHorizontal: 46,
    fontSize: 9,
    fontFamily: 'Helvetica',
    color: C.ink,
    backgroundColor: '#ffffff',
  },

  /** The frame. Two rules, outer heavier — the classic certificate edge. */
  frameOuter: {
    position: 'absolute',
    top: 26,
    left: 32,
    right: 32,
    bottom: 26,
    borderWidth: 2,
    borderColor: C.rule,
  },
  frameInner: {
    position: 'absolute',
    top: 32,
    left: 38,
    right: 38,
    bottom: 32,
    borderWidth: 0.5,
    borderColor: C.rule,
  },

  logo: { width: 158, height: 67, alignSelf: 'center', marginTop: 24 },

  title: {
    fontSize: 28,
    fontFamily: 'Times-Bold',
    textAlign: 'center',
    letterSpacing: 3.5,
    // textkit carries trailing tracking on the last glyph, which shifts a
    // centred letterspaced line left by half the tracking.
    paddingLeft: 3.5,
    marginTop: 18,
  },
  eyebrow: {
    fontSize: 8,
    letterSpacing: 2.2,
    textAlign: 'center',
    color: C.soft,
    marginTop: 7,
  },
  ornamentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 10,
  },
  ornamentLine: { width: 90, borderBottomWidth: 1, borderBottomColor: C.gold },
  ornamentDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: C.gold,
    marginHorizontal: 7,
  },

  leadIn: {
    fontSize: 10.5,
    fontFamily: 'Times-Italic',
    textAlign: 'center',
    marginTop: 24,
    color: C.soft,
  },
  subject: {
    fontSize: 18,
    fontFamily: 'Times-Bold',
    textAlign: 'center',
    marginTop: 7,
    lineHeight: 1.3,
  },

  statement: {
    fontSize: 10.5,
    fontFamily: 'Times-Roman',
    textAlign: 'center',
    lineHeight: 1.55,
    marginTop: 18,
    marginHorizontal: 22,
  },

  /** Loss particulars, as one quiet strip rather than a form. */
  strip: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 26,
    paddingTop: 9,
    paddingBottom: 8,
    borderTopWidth: 0.5,
    borderTopColor: C.hair,
    borderBottomWidth: 0.5,
    borderBottomColor: C.hair,
  },
  stripCell: { alignItems: 'center', flexGrow: 1 },
  stripLabel: {
    fontSize: 6,
    fontFamily: 'Helvetica-Bold',
    letterSpacing: 0.9,
    color: C.faint,
  },
  stripValue: { fontSize: 8.5, marginTop: 3 },

  tableHead: {
    fontSize: 8,
    fontFamily: 'Helvetica-Bold',
    letterSpacing: 1.5,
    marginTop: 24,
  },
  thead: { flexDirection: 'row', paddingBottom: 3, marginTop: 6 },
  th: {
    fontSize: 6,
    fontFamily: 'Helvetica-Bold',
    letterSpacing: 0.7,
    color: C.faint,
  },
  tr: {
    flexDirection: 'row',
    paddingVertical: 2.5,
    borderTopWidth: 0.5,
    borderTopColor: C.hair,
  },
  td: { fontSize: 8.5 },
  tdMet: { fontSize: 8, fontFamily: 'Helvetica-Bold', color: C.rule },
  tdMiss: { fontSize: 8, fontFamily: 'Helvetica-Bold', color: '#a8410f' },
  tableNote: { fontSize: 6.5, color: C.faint, marginTop: 5, lineHeight: 1.35 },

  signRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    marginTop: 40,
  },
  signBlock: { width: 176 },
  signRule: { borderBottomWidth: 0.75, borderBottomColor: C.ink },
  signName: { fontSize: 9, fontFamily: 'Helvetica-Bold', marginTop: 4 },
  signRole: {
    fontSize: 7,
    fontFamily: 'Helvetica-Oblique',
    color: C.soft,
    marginTop: 1,
  },

  fine: {
    position: 'absolute',
    bottom: 46,
    left: 62,
    right: 62,
    fontSize: 6.2,
    color: C.faint,
    textAlign: 'center',
    lineHeight: 1.4,
  },

  // ── terms sheet ──
  termsTitle: {
    fontSize: 11,
    fontFamily: 'Helvetica-Bold',
    letterSpacing: 1.6,
  },
  termsRule: { borderBottomWidth: 1, borderBottomColor: C.ink, marginTop: 6 },
  termsIntro: {
    fontSize: 8,
    fontFamily: 'Times-Italic',
    color: C.soft,
    marginTop: 8,
    lineHeight: 1.4,
  },
  termHead: { fontSize: 8.5, fontFamily: 'Helvetica-Bold', marginTop: 10 },
  term: {
    fontSize: 8,
    fontFamily: 'Times-Roman',
    lineHeight: 1.45,
    marginTop: 2,
  },
  termsFooter: {
    position: 'absolute',
    bottom: 34,
    left: 46,
    right: 46,
    fontSize: 6.5,
    color: C.faint,
    textAlign: 'center',
  },
})

const longDate = (value: string | null): string => {
  if (!value) return ''
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  const d = dateOnly
    ? new Date(
        Number(dateOnly[1]),
        Number(dateOnly[2]) - 1,
        Number(dateOnly[3]),
      )
    : new Date(value)
  return d.toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })
}

/**
 * Clip in JS rather than trusting `textOverflow` — react-pdf keeps the line
 * but lets it run past the column, so a chatty point label printed straight
 * through the column next to it.
 */
function clip(value: string, max: number): string {
  const text = value.trim()
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text
}

function StripCell({ label, value }: { label: string; value: string }) {
  if (!value) return null
  return (
    <View style={styles.stripCell}>
      <Text style={styles.stripLabel}>{label}</Text>
      <Text style={styles.stripValue}>{value}</Text>
    </View>
  )
}

/** Flat single-ink geometry — an imitation gold foil reads as plastic. */
function Seal({ year }: { year: string }) {
  const R = 40
  const ticks = Array.from({ length: 36 }, (_, i) => {
    const a = (i * Math.PI * 2) / 36
    return {
      x1: R + Math.cos(a) * 31,
      y1: R + Math.sin(a) * 31,
      x2: R + Math.cos(a) * 34.5,
      y2: R + Math.sin(a) * 34.5,
    }
  })
  return (
    <Svg width={R * 2} height={R * 2}>
      <Circle cx={R} cy={R} r={37} strokeWidth={1.5} stroke={C.gold} />
      <Circle cx={R} cy={R} r={29} strokeWidth={0.5} stroke={C.gold} />
      {ticks.map((t, i) => (
        <Line
          key={i}
          x1={t.x1}
          y1={t.y1}
          x2={t.x2}
          y2={t.y2}
          strokeWidth={0.75}
          stroke={C.gold}
        />
      ))}
      <SvgText
        x={R}
        y={R - 7}
        textAnchor="middle"
        style={{ fontSize: 6.5, fill: C.gold, fontFamily: 'Helvetica-Bold' }}
      >
        SASQUATCH
      </SvgText>
      <SvgText
        x={R}
        y={R + 2}
        textAnchor="middle"
        style={{ fontSize: 5.2, fill: C.gold, fontFamily: 'Helvetica-Bold' }}
      >
        CARPET CLEANING
      </SvgText>
      <SvgText
        x={R}
        y={R + 14}
        textAnchor="middle"
        style={{ fontSize: 7, fill: C.gold, fontFamily: 'Helvetica-Bold' }}
      >
        {year}
      </SvgText>
    </Svg>
  )
}

function visitCount(data: DryingReportData): string {
  const n = data.visits.length
  return n ? `${n} ${n === 1 ? 'visit' : 'visits'}` : ''
}

function dryingDays(cert: DryingCertificate): string {
  if (!cert.firstVisitDate || !cert.finalVisitDate) return ''
  const start = new Date(`${cert.firstVisitDate}T12:00:00`)
  const end = new Date(`${cert.finalVisitDate}T12:00:00`)
  const days = Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1
  return `${days} ${days === 1 ? 'day' : 'days'}`
}

export function DryingCertificatePages({ data }: { data: DryingReportData }) {
  const cert = buildDryingCertificate(data)
  // Nothing was measured against a standard, so there is nothing to put a
  // name to. Better no certificate than one that attests to an empty set.
  if (!cert) return null

  const address = data.address || 'the property'
  const [street, ...rest] = address.split(', ')
  const remainder = rest.join(', ')
  const missed = cert.points.filter((p) => !p.met)
  const cat = cert.category ?? 0
  const year = String(
    cert.issuedOn
      ? new Date(cert.issuedOn).getFullYear()
      : new Date().getFullYear(),
  )
  const n = cert.points.length
  // The certificate is one page and the frame is drawn on it, so the table
  // cannot be allowed to push content onto a second, unframed sheet. The full
  // log is in the report body regardless.
  const MAX_ROWS = 7
  const shown = cert.points.slice(0, MAX_ROWS)
  const overflowRows = cert.points.length - shown.length

  return (
    <>
      {/* ── The certificate ────────────────────────────────── */}
      <Page size="LETTER" style={styles.page}>
        <View style={styles.frameOuter} />
        <View style={styles.frameInner} />

        {/* eslint-disable-next-line jsx-a11y/alt-text -- react-pdf Image is not an HTML img */}
        <Image src={LOGO_URL} style={styles.logo} />

        <Text style={styles.title}>CERTIFICATE OF DRYING</Text>
        <Text style={styles.eyebrow}>STRUCTURAL DRYING COMPLETION</Text>
        <View style={styles.ornamentRow}>
          <View style={styles.ornamentLine} />
          <View style={styles.ornamentDot} />
          <View style={styles.ornamentLine} />
        </View>

        <Text style={styles.leadIn}>This is to certify that</Text>
        <Text style={styles.subject}>
          {street}
          {remainder ? `\n${remainder}` : ''}
        </Text>

        {/*
          The claim, bounded on purpose: every monitored point reached the goal
          set for it, against a benchmark printed in the table below. "The
          structure is dry" would be unbounded, disprovable by any single
          reading anywhere forever, and is not what a moisture meter measures.
        */}
        <Text style={styles.statement}>
          has undergone professional water damage mitigation and structural
          drying by {data.company.name}
          {cert.finalVisitDate
            ? `, and that at the final moisture inspection on ${longDate(
                cert.finalVisitDate,
              )}, `
            : ', and that at the final moisture inspection, '}
          {cert.allMet ? (
            <Text style={{ fontFamily: 'Times-Bold' }}>
              all {n} monitored {n === 1 ? 'location' : 'locations'} had reached
              the drying goals established for this project.
            </Text>
          ) : (
            <>
              <Text style={{ fontFamily: 'Times-Bold' }}>
                {cert.metCount} of {n} monitored locations had reached the
                drying goals established for this project.
              </Text>{' '}
              Readings at {missed.map((p) => p.label).join(', ')} remained above
              goal.
            </>
          )}
        </Text>

        <View style={styles.strip}>
          <StripCell
            label="DATE OF LOSS"
            value={longDate(data.loss.lossDate)}
          />
          {cert.category ? (
            <StripCell
              label="CATEGORY"
              value={`${cert.category} · ${CATEGORY_DESCRIPTOR[cert.category] ?? ''}`}
            />
          ) : null}
          <StripCell label="DRYING PERIOD" value={dryingDays(cert)} />
          <StripCell label="SITE VISITS" value={visitCount(data)} />
          {data.loss.claimNumber ? (
            <StripCell label="CLAIM NO." value={data.loss.claimNumber} />
          ) : null}
        </View>

        <Text style={styles.tableHead}>FINAL MOISTURE READINGS</Text>
        <View style={styles.thead}>
          <Text style={[styles.th, { width: 168 }]}>MONITORING POINT</Text>
          <Text style={[styles.th, { width: 108 }]}>MATERIAL</Text>
          <Text style={[styles.th, { width: 62, textAlign: 'right' }]}>
            DRY STD.
          </Text>
          <Text style={[styles.th, { width: 56, textAlign: 'right' }]}>
            GOAL
          </Text>
          <Text style={[styles.th, { width: 56, textAlign: 'right' }]}>
            FINAL
          </Text>
          <Text style={[styles.th, { width: 68, textAlign: 'right' }]}>
            STATUS
          </Text>
        </View>
        {shown.map((point, index) => (
          <View key={index} style={styles.tr}>
            <Text style={[styles.td, { width: 168 }]}>
              {clip(point.label, 38)}
            </Text>
            <Text style={[styles.td, { width: 108 }]}>
              {clip(point.material ?? '', 22)}
            </Text>
            <Text style={[styles.td, { width: 62, textAlign: 'right' }]}>
              {round1(point.dryStandard)}
            </Text>
            <Text style={[styles.td, { width: 56, textAlign: 'right' }]}>
              {round1(point.dryingGoal)}
            </Text>
            <Text style={[styles.td, { width: 56, textAlign: 'right' }]}>
              {round1(point.finalReading)}
            </Text>
            <Text
              style={[
                point.met ? styles.tdMet : styles.tdMiss,
                { width: 68, textAlign: 'right' },
              ]}
            >
              {point.met ? 'GOAL MET' : 'ABOVE GOAL'}
            </Text>
          </View>
        ))}
        {/*
          No "%" in that table. A meter reads true moisture content on wood and
          a relative scale on gypsum and concrete, so a "%" on a drywall row
          states a measurement that was never taken.
        */}
        <Text style={styles.tableNote}>
          Moisture meter readings. The dry standard is taken from unaffected
          material of the same type in the same structure; the drying goal is
          that standard plus {DRY_WITHIN}.
          {overflowRows > 0
            ? ` ${overflowRows} further monitoring ${
                overflowRows === 1 ? 'point is' : 'points are'
              } listed in the drying log.`
            : ''}
          {cert.excludedPointCount > 0
            ? ` ${cert.excludedPointCount} further ${
                cert.excludedPointCount === 1 ? 'point was' : 'points were'
              } monitored without a dry standard and ${
                cert.excludedPointCount === 1 ? 'appears' : 'appear'
              } in the drying log.`
            : ''}
        </Text>

        <View style={styles.signRow}>
          <View style={styles.signBlock}>
            <View style={styles.signRule} />
            <Text style={styles.signName}>{data.company.name}</Text>
            <Text style={styles.signRole}>
              Authorized representative · {longDate(cert.issuedOn)}
            </Text>
          </View>
          <Seal year={year} />
          <View style={styles.signBlock}>
            <View style={styles.signRule} />
            <Text style={styles.signName}>{data.customer.name}</Text>
            <Text style={styles.signRole}>
              Property owner or authorized representative
            </Text>
          </View>
        </View>

        {/*
          The one protective line that stays on the face. Page one gets
          photographed and texted on its own, so it cannot be silent — but it
          is a footnote here, not the document.
        */}
        <Text style={styles.fine}>
          Verified by moisture readings taken at the points and on the dates
          shown. The full reading history and the terms of this certificate are
          on the pages that accompany it.
        </Text>
      </Page>

      {/* ── Terms, the way a warranty carries them ─────────── */}
      <Page size="LETTER" style={styles.page} wrap>
        <Text style={styles.termsTitle}>TERMS OF THIS CERTIFICATE</Text>
        <View style={styles.termsRule} />
        <Text style={styles.termsIntro}>
          Issued {longDate(cert.issuedOn)} for the property at {address}. These
          terms form part of the certificate and should be kept with it.
        </Text>

        {/*
          Written as a description of the work, not a list of denials.
          Charles: "it has to be written in a way that actually supports the
          company and doesn't just try to shed every bit of liability."
          The boundaries are all still here — they just fall out of explaining
          the method properly, which is also the version that makes us look
          like we know the trade.
        */}
        <View wrap={false}>
          <Text style={styles.termHead}>How the drying was verified</Text>
          <Text style={styles.term}>
            Before drying began, a dry standard was recorded for each affected
            material — the reading taken from unaffected material of the same
            type elsewhere in the building, which is what that material reads
            when it is dry under the conditions in this structure. A drying goal
            was set from that standard, monitoring points were established, and
            each point was read with a moisture meter on every documented visit.
            Drying equipment stayed in place until the readings reached goal.
            The full reading history for every point is in the drying log in the
            attached report.
          </Text>
        </View>

        <View wrap={false}>
          <Text style={styles.termHead}>What was measured</Text>
          <Text style={styles.term}>
            A moisture meter reads the material it is placed on. The points
            listed on the certificate are the ones that were monitored; enclosed
            wall cavities, the underside of floor coverings, and spaces above
            ceilings cannot be read from the surface and are not represented by
            these readings. Where a cavity was opened during mitigation, it was
            dried and monitored the same as any other affected material.
          </Text>
        </View>

        {cat >= 2 ? (
          <View wrap={false}>
            <Text style={styles.termHead}>Category of water</Text>
            <Text style={styles.term}>
              The water affecting this property was assessed as Category {cat}{' '}
              at the time of inspection, based on the conditions then observed;
              the definitions in the S500 control. On a Category 2 or Category 3
              loss the work includes removing or cleaning affected materials as
              well as drying them. What was removed and what was cleaned is
              itemised in the scope of work in the attached report. This
              certificate covers the drying.
            </Text>
          </View>
        ) : null}

        <View wrap={false}>
          <Text style={styles.termHead}>Mold</Text>
          <Text style={styles.term}>
            Drying is how microbial growth is prevented: material held at or
            below its drying goal does not support growth, which is the reason
            the readings above matter. Testing air or surfaces for mold is a
            separate discipline from restoration drying and is not work{' '}
            {data.company.name} performs. If you want that done, an independent
            indoor environmental professional can do it.
          </Text>
        </View>

        <View wrap={false}>
          <Text style={styles.termHead}>Keeping it dry</Text>
          <Text style={styles.term}>
            Material that has been dried stays dry as long as the source of the
            water has been repaired and the space is normally ventilated.
            Repairing that source, and rebuilding anything that was removed, are
            separate from mitigation and were not part of this work unless the
            scope of work in the attached report says otherwise.
          </Text>
        </View>

        <View wrap={false}>
          <Text style={styles.termHead}>Who this is issued to</Text>
          <Text style={styles.term}>
            The customer named on the certificate and, where a claim is
            identified, that customer&apos;s insurance carrier, for this loss.
          </Text>
        </View>

        <Text style={styles.termsFooter} fixed>
          {data.company.name} · {data.company.phone} · {data.company.web}
        </Text>
      </Page>
    </>
  )
}
