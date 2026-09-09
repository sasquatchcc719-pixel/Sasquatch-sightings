import Link from 'next/link'
import { Phone, Truck, Wrench } from 'lucide-react'

// Rendered through the authenticated page so the personal contact number
// is not embedded in the public client bundle.
export function EmergencyScheduleHelp() {
  return (
    <section className="space-y-5" aria-labelledby="schedule-emergency-heading">
      <div className="rounded-2xl border border-emerald-300/20 bg-emerald-400/[0.06] p-5">
        <h2 id="schedule-emergency-heading" className="text-2xl font-bold">
          Emergency schedule changes
        </h2>
        <h3 className="mt-4 text-lg font-semibold">
          1. Call Charles’s wife right away
        </h3>
        <a
          href="tel:+17193674806"
          className="mt-4 flex min-h-12 items-center justify-center gap-2 rounded-xl bg-emerald-400 px-3 py-3 text-base font-bold text-slate-950 hover:bg-emerald-300"
        >
          <Phone className="h-4 w-4 shrink-0" />
          Call 719-367-4806
        </a>
        <p className="mt-4 text-sm leading-relaxed text-slate-300">
          Once safely stopped, call as soon as you know the next appointment is
          affected. She will call that customer and arrange the reschedule while
          you focus on getting back on the road.
        </p>
        <p className="mt-4 text-sm leading-relaxed text-slate-300">
          Give her the customer’s name, address, appointment time, what
          happened, and your plan to get back to base. Share your best estimate
          of when you can resume; if you do not know yet, tell her you will
          update her.
        </p>
        <blockquote className="mt-4 border-l-2 border-emerald-300/40 pl-3 text-sm leading-relaxed text-emerald-100">
          “It’s David. I’ve had a truck or machine problem and can’t make my
          next appointment. The customer is [name], scheduled for [time] at
          [address]. Please call them to reschedule. I’m arranging a switch at
          base and will update you on when I can continue.”
        </blockquote>
      </div>

      <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-5">
        <h3 className="text-lg font-semibold">
          2. Get back to base and switch trucks
        </h3>
        <div className="mt-4 space-y-4">
          <div className="rounded-xl border border-white/10 bg-slate-950/50 p-4">
            <h4 className="flex items-center gap-2 font-semibold text-emerald-200">
              <Wrench className="h-4 w-4 shrink-0" />
              Machine issue; truck still drives safely
            </h4>
            <p className="mt-2 text-sm leading-relaxed text-slate-300">
              Head back to base and switch into the other truck with working
              equipment. Take the keys, tools, and supplies you need for the
              remaining jobs.
            </p>
          </div>
          <div className="rounded-xl border border-white/10 bg-slate-950/50 p-4">
            <h4 className="flex items-center gap-2 font-semibold text-amber-200">
              <Truck className="h-4 w-4 shrink-0" />
              Truck breakdown; cannot drive back
            </h4>
            <p className="mt-2 text-sm leading-relaxed text-slate-300">
              Arrange the roadside help or tow the truck needs using the other
              categories above. Coordinate the truck’s pickup and keys with the
              provider, then take an Uber or ask a buddy for a ride back to
              base. Pick up the other truck and its working equipment.
            </p>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-5">
        <h3 className="text-lg font-semibold">
          3. Confirm the plan and finish the day
        </h3>
        <p className="mt-2 text-sm leading-relaxed text-slate-300">
          Before leaving base, check that the replacement truck and cleaning
          equipment are ready. Call Charles’s wife with your updated timing and
          confirm which appointment you will attend next.
        </p>
        <p className="mt-3 text-sm leading-relaxed text-slate-300">
          Aim to lose only the affected appointment. If the recovery takes
          longer than expected, update her promptly so she can contact any
          additional customers who are affected. Resume the remaining jobs as
          soon as practical.
        </p>
        <p className="mt-3 text-sm leading-relaxed text-slate-300">
          Save any ride, towing, or repair receipts for Sasquatch Carpet
          Cleaning in{' '}
          <Link
            href="/tech/receipts"
            className="text-emerald-200 underline underline-offset-4"
          >
            Receipts
          </Link>
          .
        </p>
        <Link
          href="/tech"
          className="mt-4 inline-flex min-h-11 items-center justify-center rounded-xl border border-emerald-300/30 bg-emerald-300/10 px-4 py-3 text-sm font-semibold text-emerald-200 hover:bg-emerald-300/20"
        >
          Open today’s jobs
        </Link>
      </div>
    </section>
  )
}
