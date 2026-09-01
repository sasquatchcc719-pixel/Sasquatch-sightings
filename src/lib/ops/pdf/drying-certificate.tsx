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
          This certificate reports moisture measurements taken at the locations
          and on the dates shown. It is not a determination that the structure
          or its contents are free of mold, that indoor air quality is
          acceptable, or that the premises are safe or habitable. Issued subject
          to the terms on the reverse, which form part of it.
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

        <View wrap={false}>
          <Text style={styles.termHead}>What this certificate reports</Text>
          <Text style={styles.term}>
            {data.company.name} performed water damage mitigation and
            restorative drying at the property named on the certificate
            {cert.firstVisitDate
              ? `, beginning ${longDate(cert.firstVisitDate)}`
              : ''}
            {cert.finalVisitDate
              ? ` and concluding with a final moisture inspection on ${longDate(
                  cert.finalVisitDate,
                )}`
              : ''}
            . For each monitored material a dry standard was recorded from
            unaffected material of the same type within the same structure, as
            described in ANSI/IICRC S500, and a drying goal was established from
            it. Readings were taken at the monitoring locations identified on
            the certificate and in the drying log, using a moisture meter, on
            each documented visit. The certificate reports the value recorded at
            each point as of the final documented reading, and whether that
            value was at or below the goal established for that point. The
            drying log in the attached report forms part of this record.
          </Text>
        </View>

        <View wrap={false}>
          <Text style={styles.termHead}>What it does not determine</Text>
          <Text style={styles.term}>
            A drying goal is a project completion benchmark. Meeting it is not a
            determination that a material has returned to its pre-loss moisture
            content, that the structure or its contents are free of mold or
            other microbial growth, that indoor air quality is acceptable, that
            the premises are safe or habitable, or that moisture-related damage
            will not occur in the future. This is not a clearance, a mold
            assessment, an indoor environmental assessment, an industrial
            hygiene evaluation, or a post-remediation verification.
          </Text>
        </View>

        {/*
          Fires on Cat 2 and Cat 3. Without it the certificate prints "Grossly
          contaminated" on its face, reports only on moisture, and says drying
          is complete — which reads as a representation that the contamination
          was resolved.
        */}
        {cat >= 2 ? (
          <View wrap={false}>
            <Text style={styles.termHead}>Category of water</Text>
            <Text style={styles.term}>
              The water affecting this property was assessed as Category {cat}{' '}
              at the time of inspection, based on the conditions then observed.
              Category can change over time with temperature, elapsed time, and
              contact with other materials; the definitions in ANSI/IICRC S500
              control. Where water is assessed as Category 2 or Category 3,
              mitigation also involves removal or cleaning of affected
              materials. This certificate reports moisture measurements only. It
              does not report on, and is not a determination of, whether
              contamination was removed, whether cleaning was effective, or
              whether any surface, material, cavity, or contents item is free of
              bacteria, sewage constituents, or other contaminants. No sampling
              of any kind was performed.
            </Text>
          </View>
        ) : null}

        <View wrap={false}>
          <Text style={styles.termHead}>Areas not measured</Text>
          <Text style={styles.term}>
            Moisture may be present in locations that were not accessible for
            inspection or measurement, including within wall cavities, beneath
            floor coverings, inside building assemblies, above ceilings, in
            crawl spaces, and anywhere outside the documented scope of this
            work. No measurement was taken at any location other than those
            recorded on the certificate and in the drying log.
          </Text>
        </View>

        <View wrap={false}>
          <Text style={styles.termHead}>Mold</Text>
          <Text style={styles.term}>
            The U.S. Environmental Protection Agency states that &ldquo;it is
            impossible to eliminate all mold and mold spores in the indoor
            environment.&rdquo; Mold spores are naturally present indoors and
            outdoors at all times. {data.company.name} makes no representation
            that this property is or will remain free of mold or microbial
            growth, and has not performed, and is not qualified to perform, mold
            assessment, air or surface sampling, or post-remediation
            verification. If independent verification of conditions is wanted,
            the property owner should retain an independent indoor environmental
            professional of the owner&apos;s own choosing, at the owner&apos;s
            expense.
          </Text>
        </View>

        <View wrap={false}>
          <Text style={styles.termHead}>
            Future conditions and cause of loss
          </Text>
          <Text style={styles.term}>
            Whether microbial growth occurs in the future depends on ongoing
            control of moisture, humidity and ventilation, and on repair of the
            underlying cause of the loss. Repair of the underlying cause, and
            reconstruction or build-back of any removed materials, were not
            included in the mitigation work described unless separately
            documented. {data.company.name} is neither an insurer nor a
            guarantor against water, moisture, ventilation, mold, or other
            conditions.
          </Text>
        </View>

        {/*
          The paragraph almost every restoration certificate omits, and the one
          that addresses the actual mechanism — a future buyer or lender who was
          never a party to anything, relying on a document found in a file.
        */}
        <View wrap={false}>
          <Text style={styles.termHead}>Who may rely on this certificate</Text>
          <Text style={styles.term}>
            This certificate is issued to the customer named on it, and to that
            customer&apos;s insurance carrier where one is identified, for the
            sole purpose of documenting completion of the mitigation work
            described. It is not issued for, and may not be relied upon by, any
            other person or entity, including any prospective purchaser, tenant,
            lender, or inspector.
          </Text>
        </View>

        <Text style={styles.termsFooter} fixed>
          {data.company.name} · {data.company.phone} · {data.company.web}
        </Text>
      </Page>
    </>
  )
}
