# Vehicle-based Live Dispatch

The operations calendar Map panel and `/admin/operations/dispatch` use the same
`FleetTrackerDashboard` and hardware tracker feed. `/admin/fleet/tracking` redirects
to Live Dispatch so existing bookmarks continue working. There is one map system,
with vehicle status, latest position, and movement history.

The retired `DispatchMap` depended on `gps_shifts` and technician phone points.
`GpsTrackerProvider` is no longer mounted by the application; the old GPS time
clock is archived (see `ARCHIVED_GPS_TIME_CLOCK.md`). Its map was not an active
replacement for hardware tracking. Remove its presentation, but retain archived
records and backend code: deleting historical data or changing payroll is not part
of consolidating dispatch.

Current payroll uses `ops_timesheet_entries`; vehicle telemetry does not create
shifts, clock staff in/out, alter payroll, or complete jobs. The old phone GPS API's
shadow arrival stamping is not invoked by hardware telemetry.

Next development can associate vehicles with their operators and scheduled jobs,
then add verified arrival/departure observations to this shared dispatch system.
Those associations, job pins, and automatic arrival detection are not implemented
by this consolidation. Never infer the driver from a device name or proximity.

Dispatch read access is restricted server-side to owners, admins, and dispatchers.
The existing service-only tracker tables and device-token authentication remain
unchanged. API responses continue to exclude token hashes.
