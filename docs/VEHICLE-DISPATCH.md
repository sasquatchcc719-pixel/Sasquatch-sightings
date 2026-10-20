# Live Dispatch

Live Dispatch is the one vehicle-based tool shared by the calendar Map panel and
`/admin/operations/dispatch`. The old technician `DispatchMap` is retired;
`/admin/fleet/tracking` redirects to the new tool for existing bookmarks.

## Daily view

The calendar passes its selected date and technician filter into the panel. A
standalone date picker is available on the dispatch page. The primary map shows
that day's numbered job pins, scheduled times, assigned technicians, and job links.
Cancelled and parked visits are excluded. The read-only daily-map endpoint uses
owner/admin/dispatcher authorization and returns no phone, email, gate, or device
credentials.

Job pins accept verified street geocodes (including the official Colorado Springs
address-point repair source) or captured on-site GPS. Unverified raw geocodes and
known area centroids are rejected. Unmapped jobs remain visible in the list with a
location-verification notice; the map never invents a pin.

Colorado addresses now use the state's county-supplied address-point dataset
first, with exact house/street and city or ZIP matching. Existing verified
Nominatim and strict backfill results remain accepted; Nominatim is the fallback
when the official dataset has no exact point. Coordinates are saved on the shared
service-address row and invalidated when address text changes. New-address and
booking reuse lookups finish before the server responds, rather than relying on
an unawaited request that a serverless process may suspend. No paid geocoding
account or new subscription is required. Ambiguous/typo results still need review.

Current vehicle positions appear only on today's view. Past and future dates show
the relevant jobs without overlaying today's vans. Offline markers retain their
last reported position and are labeled offline.

## Driving archive

Tracks are hidden by default. Opening Driving history loads the selected vehicle's
GPS samples for that Mountain Time day (including 23/25-hour DST days). It can show
the full day's trace or one observed motion interval. Closing the archive clears
the trace and returns focus to job locations. Existing GPS retention is 30 days.

Motion intervals use speed above 1 m/s, split on signal gaps over 90 seconds and
sustained stops of at least two minutes. Times are observed GPS motion boundaries,
not verified arrivals, work duration, road distance, or automatic job completion.
The tracker is not yet associated with an operator or appointment, so the UI does
not guess which job a drive belongs to.

## Archived phone GPS and payroll

The retired map depended on `gps_shifts` and technician phone points.
`GpsTrackerProvider` is no longer mounted by the application; the old GPS time
clock is archived (see `ARCHIVED_GPS_TIME_CLOCK.md`). Historical records and backend
code remain for reference. Current payroll uses `ops_timesheet_entries`; hardware
telemetry does not alter shifts, payroll, or job status. The old phone GPS API's
shadow arrival stamping is not invoked by hardware telemetry.

## Private invoice travel history

Runtime configuration assigns each truck to a technician and a verified base
point. Base addresses and coordinates stay in the private configuration table,
not source control. Recording begins at the configuration's `enabled_at`;
earlier prototype drives are not backfilled.

A statement-level database trigger processes only newly accepted hardware points
in timestamp order, in the same transaction as telemetry ingestion. It follows
the assigned technician's scheduled addresses for the point's Mountain Time day.
A base stop uses a 150 m radius, jobs 100 m, and requires at least 60 seconds of
consecutive low-speed observations (at most 2.5 m/s). Departure requires 30 seconds
outside the larger exit boundary (200 m base / 150 m jobs). The first observed
entry/exit is saved after that dwell confirms it. GPS visits are observations of
vehicle presence; they do not establish that work started or finished.

`fleet_job_visits` retains arrival/departure and address snapshots. `fleet_job_trips`
retains incoming/outgoing origins, destinations, times, observed distance, signal
gaps, and a sparse actual-point route (15-second samples, capped around 2,000).
They are not removed by the raw GPS history's 30-day cleanup. Distances exclude
gaps over 90 seconds and implausible jumps; route maps break at those points.
Starting away from an established stop gets an explicit unknown origin instead
of an invented base departure. Reassignment closes incomplete trips and resets
observation state, preserving old records. Late older points remain raw history
without rewriting the already-established invoice ledger.

Owner/admin/dispatcher users have a collapsed **Vehicle travel & visits** section
on the admin invoice page. A separate role-checked `vehicle-history` endpoint
reads only that invoice's appointment. Shared invoice responses, technician
views, PDFs, customer portals, email and QuickBooks contain no vehicle ledger.
All four storage tables have RLS and revoke browser-role access; service-role
server access is required. There are no payroll, job-status or messaging writes.

Verification: `scripts/test-private-fleet-journeys.mjs` runs the actual SQL against
a local PGlite PostgreSQL database, never production. Set `PGLITE_MODULE` to an
installed `@electric-sql/pglite` module, then run it with Node. It covers a complete
base/job/job/base drive, jitter, short drive-bys, assignments, signal gaps,
duplicates, older uploads, reassignment, and private-table access. API and panel
tests cover authorization, invoice scoping, lazy loading and gap labels.

Road-based travel estimates and customer tracking links remain future work.
