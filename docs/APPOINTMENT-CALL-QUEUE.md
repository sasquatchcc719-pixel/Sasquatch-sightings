# Appointment call queue

Business-hours callers select 1 at the existing spam-screening menu and enter
the native Twilio `sasquatch-appointments` queue. Twilio enforces a limit of ten
waiting callers; overflow goes directly to the existing voicemail flow. Each
caller can wait for 180 seconds before voicemail, including time spent waiting
while staff help someone else. After-hours routing and option 2 are unchanged.

The original eight-second ambient pad in `public/audio/appointment-hold.mp3`
loops while callers wait. Short final pauses keep the timeout near 180 seconds.
The wait webhook returns audio immediately and runs the dispatcher through
Next.js `after()`, so provider latency does not block hold audio.

The dispatcher rings the saved primary forwarding phone for up to 20 seconds per
attempt. Answer and **press 1 to accept**; then Twilio bridges the oldest waiting
caller. Carrier voicemail or any other input cannot accept a customer call.
The next waiting poll (normally within eight seconds) retries an unanswered
attempt or rings for the next caller after the previous conversation ends.
An empty queue does not start another attempt. An already ringing attempt can
finish its short ring/prompt cycle if its last waiting caller leaves.

`appointment_call_dispatch` is a service-role-only singleton containing the
Twilio queue SID and one attempt token/worker SID. Atomic claims serialize
concurrent polls. Bound workers keep their slot throughout the conversation;
only a matching terminal callback or verified terminal provider status releases
it. A pending claim without a worker expires after 90 seconds, protecting against
duplicate calls after an uncertain outbound API response. Old attempt tokens
cannot accept or release a newer attempt.

The signed `Queue` bridge callback associates the actual FIFO caller with the
independent outbound worker. Call-history reconciliation uses that evidence
instead of expecting an outbound child call. Queue completion ends answered
calls without invoking the voicemail or missed-call SMS handler.

## Provisioning and checks

1. Apply `20261022220304_add_appointment_call_queue.sql`.
2. Create a Twilio queue named `sasquatch-appointments` with `maxSize: 10`, and
   save its returned SID in `appointment_call_dispatch.queue_sid`.
3. Deploy the IVR and both `appointment-queue` / `appointment-agent` webhooks.
   The main number remains pointed at `/api/twilio/call-router`.
4. Run the focused Twilio tests and the transactional assertions in
   `supabase/tests/appointment_call_queue.sql`.
5. For a manual phone check during business hours, call the business number,
   press 1, verify music and cell ringing, then answer and press 1. Use a second
   caller to check waiting/FIFO, and let a caller wait three minutes to check
   voicemail. These checks ring a real phone.

Rollback routing by reverting the IVR option-1 change to its previous forwarding
flow and deploying. Leave the additive schema and voicemail evidence in place.
