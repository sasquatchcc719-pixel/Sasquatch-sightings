# Harry Control Runbook

## Purpose

Operate Harry safely with explicit toggles and rapid rollback paths.

## Core Admin Surface

- Dashboard: `/admin/harry/control`
- Settings API: `/api/admin/harry/control`
- Profiles API: `/api/admin/harry/profiles`
- Knowledge API: `/api/admin/harry/knowledge`

## Toggle Model

- Every function group has an ON/OFF switch.
- Current live functions are seeded ON.
- New functions must default OFF until manually enabled.
- Booking destination cutover is controlled by `Use Ops Booking Destination`.
- Detailed scope for booking cutover: `docs/HARRY-BOOKING-SWITCH-NOTES.md`.

## Emergency Response

1. Open `/admin/harry/control`.
2. Turn **Global Harry Enable** OFF.
3. Confirm inbound behavior quiets immediately.
4. Keep intake ON but auto-reply OFF if you want logging without replies.

## Analyst Disable Policy

- `HARRY_ANALYST_ENABLED=false` disables Analyst action endpoints.
- `HARRY_ANALYST_HISTORY_READONLY=true` keeps admin read-only history access.
- No analyst data is deleted.

## Rollback Notes

- If control tables are unavailable, runtime falls back to built-in safe defaults.
- Re-enable global + specific function toggles in the dashboard as needed.
- No key rotation is required for standard rollback.

## Verification Checklist

- Inbound SMS still responds when global + auto-reply are ON.
- Turning one function OFF only affects that capability.
- Analyst endpoints return disabled response while SMS runtime remains active.
- History endpoint remains readable for admins when configured.
