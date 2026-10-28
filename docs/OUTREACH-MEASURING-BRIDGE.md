# Outreach measuring bridge

Dedicated server-to-server path: `POST https://sightings.sasquatchcarpet.com/api/integrations/outreach/measurements` with JSON and `Authorization: Bearer <OUTREACH_BRIDGE_SECRET>`. The independently generated secret must be at least 32 characters, server-only, and installed in both projects. No existing agent executor or broad Supabase key is shared. `OUTREACH_MEASUREMENT_WRITES_ENABLED` must be exactly `true` in Sightings before a new appointment can commit; absence is disabled. Keep it disabled during rebuild testing. Preview, identity lookup, slots, and recovery remain available with the bridge credential.

No action exposes service bookings, invoice creation, estimate prices/lines, send-email, SMS, staff notifications, cancellation, arbitrary HTTP, or customer-profile updates. Confirm creates a new `kind=estimate`, `estimate_status=draft`, zero-quoted, QuickBooks-held appointment. It uses the same pure calendar calculations as Book Job, staff opening defaults/date overrides, staff-specific hours, unassigned work, and continuous multi-day blocks. Visit duration is 15–180 minutes, default 60, plus the existing 60-minute measuring buffer (maximum 240 minutes). Start/end returned in the receipt describe the reserved calendar block, which includes the buffer.

## Requests

- `{"action":"match","email":"contact@example.test"}` accepts optional `email`, `phone`, or `customer_id` (at least one). Returns `candidates:[{id,business_name,full_name,email,phone,sites:[{id,street_1,street_2,city,state,zip_code}],sites_truncated}],truncated`. At most 21 compact candidate rows; `truncated=true` means narrow the supplied identity. Saved sites are limited to 100 with explicit truncation. Lookup never creates or merges a record.
- `{"action":"slots","appointment_date":"2026-11-02","visit_duration_minutes":60,"assigned_staff_user_id":"UUID"}`; assigned staff is optional. Returns `{timezone:"America/Denver",visit_duration_minutes,calendar_duration_minutes,staff:[{staff_user_id,staff_name,slots:[{start_time,end_time}]}]}`. Dates must be in the coming year. Empty staff/slots is unavailable, never permission to invent a time.
- `{"action":"preview",...input}` returns `{preview_token,expires_at,preview}`. Input is defined below. Already terminal operation keys return their saved outcome; changed details are rejected. Previews are stateless and write nothing. The signed token binds the full normalized input and exact database snapshot version for 10 minutes. It must stay server-side in Outreach.
- `{"action":"confirm","operation_key":"UUID","preview_token":"SIGNED_TOKEN"}` returns a durable terminal outcome, below. A genuine explicit appointment instruction/accepted time must be reviewed in Outreach before confirm; merely creating an account is never authority to book.
- `{"action":"status","operation_key":"UUID"}` returns a terminal outcome or `{status:"not_found",receipt:null}`. `not_found` is **not** definitive while another confirm may be in flight. Keep the same key and recover; never create a replacement key for an uncertain request.

Input:

```ts
type Input = {
  operation_key: string // UUID; immutable intent, reused on every retry
  account_id: string // Outreach account UUID
  identity:
    | { mode: 'existing'; customer_id: string; service_address_id: string }
    | { mode: 'new_site'; customer_id: string; site: Site }
    | {
        mode: 'new_customer'
        customer: {
          business_name: string
          contact_name: string
          phone: string
          email?: string
        }
        site: Site
      }
  appointment_date: string // YYYY-MM-DD, America/Denver
  start_time: string // HH:MM; exact live slot
  assigned_staff_user_id: string // Sightings staff_users.id, not auth.users.id
  visit_duration_minutes: number // integer 15..180, default60
  job_description: string // 1..5000 characters, no price/approval claims
}
type Site = {
  street_1: string
  street_2?: string
  city: string
  state: string
  zip_code: string
}
```

A new prospect requires a real contact name and phone; an unknown email stays absent. Existing phone/email matches require explicit selection rather than automatic merging. To add a branch, choose the matching customer and use `new_site`. An existing matching saved street/unit/ZIP must be selected explicitly. Saved customer and site details are never overwritten. Invalid saved contact/address data must be corrected through normal Sightings staff tools first.

Preview includes input, the exact `customer`, `site`, `staff_name`, `end_time`, `calendar_duration_minutes`, and `effects:{appointment_kind:"estimate",invoice:false,email:false,sms:false,staff_notifications:false}`.

## Durable outcomes and recovery

Confirmed:

```ts
{status:'confirmed',receipt:{operation_key,account_id,appointment_id,customer_id,service_address_id,
 assigned_staff_user_id,appointment_date,start_time,end_time,visit_duration_minutes,calendar_duration_minutes,
 confirmation_number,app_url,email_sent:false,sms_sent:false,invoice_created:false}}
```

Rejected:

```ts
{status:'rejected',receipt:null,code:string,error:string,definitive:true}
```

A rejection is terminal for that operation key and proves that it cannot later create an appointment. The server acquires the operation lock before testing expiry, the write gate, stale data, identity, and calendar conflicts. Business writes run in a subtransaction; failure rolls them all back before committing the rejected tombstone. The operation also locks the Outreach account to refuse a second active measuring visit under another key. Staff/date advisory locks are shared with the low-level booking primitives; short table locks cover manual writers too. A changed snapshot requires a new preview. Receipt replay works even if a token has expired or the write gate is now disabled.

An HTTP 503, timeout, disconnected response, or `STATUS_UNAVAILABLE`/`CONFIRM_UNCERTAIN` is ambiguous: recover `status` with the original key or retry the identical confirm. Do not clear or replace that key until a terminal outcome is recovered. The server deliberately does not claim that `not_found` proves no concurrent request will commit. After a **terminal rejected** outcome, Outreach may create a fresh intent and preview after fixing the cause. Request reuse with different immutable details is refused.

## Verification

Only local mocked unit tests and isolated SQL fixtures are permitted during this rebuild. `supabase/tests/outreach_measuring_bridge_fixture.sql` creates its own fake schema and roles and must never be run against a real database. Replace its explicit migration marker with the migration contents in a fresh local PostgreSQL/PGlite database. Unit files load no `.env.local` or network credentials. No production appointment or customer message is required for testing. Before activation, verify owner login, bridge auth, deployed migration/response schemas, and the complete Outreach browser preview/recovery flow while writes remain disabled. Outgoing Outreach email has its separate hard lock and stays off.
