#!/usr/bin/env bash
set -euo pipefail
TASK_REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$TASK_REPO_DIR"
# Selected suites were inspected: all use pure fixtures/mocks, no .env loading or real sends.
pnpm exec vitest run --cache false \
  src/lib/ops/gap-{read,planning,outreach,invoice-edit,offer}.test.ts \
  src/app/api/twilio/gap-status/route.test.ts \
  src/lib/ops/availability.test.ts \
  src/lib/mcp/{server,release,business-operations,operations,auth}.test.ts \
  src/lib/ops/{tomorrow-fill-notifications,tomorrow-fill-rules,estimate-conversion,estimate-email-delivery,create-ai-style-booking-preview,create-ai-style-booking}.test.ts \
  src/components/nfc/NfcBookingWidget.test.tsx \
  src/components/tech/fiber-check-modal.test.tsx \
  src/app/api/public/{appointments,promo-preview}/route.test.ts \
  'src/app/api/admin/ops/invoices/[id]/route.test.ts' \
  'src/app/api/tech/appointments/[id]/gap-invoice-routes.test.ts'
