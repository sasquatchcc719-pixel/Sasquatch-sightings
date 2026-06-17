# Archived GPS Time Clock

The GPS-backed time clock is intentionally archived.

Payroll should use `ops_timesheet_entries` as the source of truth. Do not use
`gps_shifts` as payroll input unless the GPS time clock is deliberately rebuilt
and reactivated in a future project.

Archived pieces still exist in the repository for future reference:

- `src/hooks/useGpsTracker.ts`
- `src/contexts/GpsTrackerContext.tsx`
- `src/app/api/admin/ops/gps/*`
- `src/lib/ops/gps-shift-completion.ts`
- `src/components/admin/GpsClockBar.tsx`
- `src/components/admin/GpsStatusBar.tsx`
- `src/components/tech/tech-clock-control.tsx`

Current rule: the payroll timesheet page only reads and writes simple payroll
entries from `ops_timesheet_entries`.
