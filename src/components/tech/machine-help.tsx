import Image from 'next/image'
import { MapPin, Phone } from 'lucide-react'

const panel = 'rounded-2xl border border-white/10 bg-white/[0.04] p-4 sm:p-5'
const action =
  'inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-emerald-300/30 bg-emerald-300/10 px-4 py-3 text-sm font-semibold text-emerald-200 hover:bg-emerald-300/20'

export function MachineHelp({
  onSchedule,
  onRepair,
}: {
  onSchedule: () => void
  onRepair: () => void
}) {
  return (
    <section className="space-y-5" aria-labelledby="machine-help-heading">
      <div className="rounded-2xl border border-emerald-300/20 bg-emerald-400/[0.06] p-4 sm:p-5">
        <p className="text-xs font-semibold tracking-wider text-emerald-300 uppercase">
          Truckmount carpet-cleaning machine
        </p>
        <h2 id="machine-help-heading" className="mt-2 text-2xl font-bold">
          Sapphire Scientific 370 stopped running
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-slate-300">
          Charles’s first checks for this machine, before arranging a repair
          visit. If a customer’s appointment is affected, use Schedule changes
          to keep the rest of the day moving.
        </p>
        <button type="button" className={`${action} mt-4`} onClick={onSchedule}>
          Handle an affected appointment
        </button>
      </div>

      <div className={panel}>
        <h3 className="text-lg font-semibold">1. Check the dump tank first</h3>
        <p className="mt-2 text-sm leading-relaxed text-slate-300">
          If the dump tank is full, empty it at an approved disposal location,
          close the drain, and try starting the machine again using the normal
          startup procedure. Do not bypass the tank’s shutoff switch.
        </p>
        <p className="mt-3 text-sm leading-relaxed text-emerald-200">
          Running normally again? Continue the job. Still not running? Check the
          fuel filter next.
        </p>
      </div>

      <div className={panel}>
        <h3 className="text-lg font-semibold">
          2. Get the correct fuel filter
        </h3>
        <p className="mt-2 text-sm leading-relaxed text-slate-300">
          Charles has found this filter is usually the culprit when emptying the
          dump tank does not solve the problem. This is his specified
          replacement for our 370.
        </p>
        <div className="mt-4 flex items-center gap-4 rounded-xl border border-amber-300/25 bg-amber-300/5 p-3">
          <a
            href="/tech/vehicle-help/napa-gold-3054.jpg"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Open Charles’s fuel filter photo"
            className="shrink-0"
          >
            <Image
              src="/tech/vehicle-help/napa-gold-3054.jpg"
              alt="Charles’s NAPA Gold fuel filter box labeled 3054"
              width={120}
              height={160}
              sizes="120px"
              className="h-40 w-28 rounded-lg object-cover sm:w-30"
            />
          </a>
          <div>
            <p className="font-semibold text-amber-200">
              NAPA Gold Fuel Filter
            </p>
            <p className="mt-1 text-4xl font-bold tracking-tight">3054</p>
            <p className="mt-2 text-sm text-slate-300">
              Ask for part FIL 3054. Tap the photo to show the box at the
              counter.
            </p>
            <a
              href="https://www.napaonline.com/en/p/FIL3054"
              target="_blank"
              rel="noopener noreferrer"
              className="mt-3 inline-block text-sm text-emerald-200 underline underline-offset-4"
            >
              NAPA part listing
            </a>
          </div>
        </div>
        <p className="mt-4 font-semibold">NAPA · North Academy</p>
        <p className="mt-1 text-sm text-slate-300">
          3999 N Academy Blvd, Colorado Springs, CO 80917
        </p>
        <p className="mt-2 text-sm leading-relaxed text-slate-300">
          Charles’s suggested store near David’s usual work area. Any NAPA store
          is fine; call to confirm the 3054 is in stock before driving over.
          Charles has had trouble finding it at other auto parts stores.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <a href="tel:+17195741650" className={action}>
            <Phone className="h-4 w-4" /> Call NAPA · (719) 574-1650
          </a>
          <a
            href="https://maps.apple.com/?daddr=3999%20N%20Academy%20Blvd%2C%20Colorado%20Springs%2C%20CO%2080917&dirflg=d"
            target="_blank"
            rel="noopener noreferrer"
            className={action}
          >
            <MapPin className="h-4 w-4" /> NAPA directions in Apple Maps
          </a>
        </div>
        <a
          href="https://maps.app.goo.gl/X7AQutWuTWz6sc3B6"
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3 inline-block text-sm text-slate-300 underline underline-offset-4"
        >
          Charles’s Google Maps location
        </a>
      </div>

      <div className={panel}>
        <h3 className="text-lg font-semibold">3. Replace the fuel filter</h3>
        <div className="mt-3 rounded-xl border border-white/10 p-3 text-sm text-slate-200">
          <h4 className="font-semibold">Tools needed</h4>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>Socket set</li>
            <li>Adjustable wrench</li>
            <li>A pair of vice grips</li>
          </ul>
          <p className="mt-2 text-slate-300">
            Check the truck for these before starting.
          </p>
        </div>
        <p className="mt-2 text-sm leading-relaxed text-amber-100">
          Park on level ground and set the parking brake. Turn the van and
          machine off, remove the keys, and let the engine and exhaust cool
          before crawling underneath. Work in ventilation, away from smoking,
          flames, or sparks. Only do this if you know this fuel-line setup;
          otherwise call Matt.
        </p>
        <ol className="mt-4 list-decimal space-y-3 pl-5 text-sm leading-relaxed text-slate-200">
          <li>
            <strong>Find the fuel filter.</strong> Crawl underneath the van and
            look directly below the truckmount. The fuel filter is mounted there
            in plain sight.
          </li>
          <li>
            Take a photo of the old filter’s hose connections and direction. Use
            vice grips to gently pinch the flexible fuel lines just enough to
            stop the fuel flow. Do not crush, cut, or damage the hoses.
          </li>
          <li>
            Catch any fuel in a fuel-safe container. Loosen the hose clamps,
            take off the old filter, and install the new 3054 with each hose on
            its correct connection and the same flow direction. Do not guess or
            interchange the connections.
          </li>
          <li>
            Secure the hose clamps, remove all vice grips, and check the hoses
            and connections for leaks. Clean up spilled fuel before restarting.
          </li>
          <li>
            Try the normal startup procedure and check for leaks again. If it
            leaks, shut it off. Do not keep trying to run it with a fuel leak,
            damaged hose, or an oil-pressure or overheating warning.
          </li>
        </ol>
      </div>

      <div className={panel}>
        <h3 className="text-lg font-semibold">4. Still not running?</h3>
        <p className="mt-2 text-sm leading-relaxed text-slate-300">
          Stop troubleshooting and call Matt at Mountain Motorsport before
          bringing it in. Tell him you checked the dump tank and whether you
          changed the 3054 filter. Use the schedule plan to switch trucks at
          base and finish the remaining jobs. Keep the filter receipt under
          Sasquatch Carpet Cleaning.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" className={action} onClick={onRepair}>
            Call Matt / repair shop details
          </button>
          <button type="button" className={action} onClick={onSchedule}>
            Switch trucks & manage the schedule
          </button>
        </div>
      </div>
    </section>
  )
}
