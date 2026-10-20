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

Next development can associate vehicles with operators and jobs, add verified
arrival/departure events and road-based travel estimates, then build temporary
customer tracking links on this same system.
