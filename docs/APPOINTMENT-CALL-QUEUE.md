# Appointment call queue

Callers select 2 at the existing spam-screening menu and enter
the native Twilio `sasquatch-appointments` queue. Twilio enforces a limit of ten
waiting callers; overflow goes directly to the existing voicemail flow. Each
caller can wait for 180 seconds before voicemail, including time spent waiting
while staff help someone else. Option 1 remains the water-damage route.

The original eight-second ambient pad in `public/audio/appointment-hold.mp3`
loops while callers wait. Short final pauses keep the timeout near 180 seconds.
The wait webhook returns audio immediately and runs the dispatcher through
Next.js `after()`, so provider latency does not block hold audio.

The dispatcher separately rings the saved primary forwarding phone (Tiffany),
then the secondary phone (Charles) if the first attempt is not accepted. Staff
see the business number because the caller remains on the separate hold-music
leg. Answer and **press 1 to accept**; only then does Twilio dequeue and bridge
that exact caller. Carrier voicemail or any other input cannot accept a call.
If neither phone accepts, the caller enters the existing voicemail flow.

`appointment_call_dispatch` is a service-role-only singleton containing the
Twilio queue SID, exact caller SID, primary/secondary stage, acceptance flag,
and one attempt token/worker SID. Atomic claims serialize concurrent polls.
Bound workers keep their slot throughout the conversation; only a matching
terminal callback or verified terminal provider status advances or releases it.
A pending claim without a worker expires after 30 seconds. Old attempt tokens
cannot accept, advance, or release a newer attempt.

The signed `Queue` bridge callback associates the actual FIFO caller with the
independent outbound worker. Call-history reconciliation uses that evidence
instead of expecting an outbound child call. Queue completion ends answered
calls without invoking the voicemail or missed-call SMS handler.

## Provisioning and checks

1. Apply `20261022220304_add_appointment_call_queue.sql` and
   `20261112043000_restore_appointment_hold_music.sql`.
2. Create a Twilio queue named `sasquatch-appointments` with `maxSize: 10`, and
   save its returned SID in `appointment_call_dispatch.queue_sid`.
3. Deploy the IVR and both `appointment-queue` / `appointment-agent` webhooks.
   The main number remains pointed at `/api/twilio/call-router`.
4. Run the focused Twilio tests and the transactional assertions in
   `supabase/tests/appointment_call_queue.sql`.
5. For a manual phone check, call the business number, press 2, verify music and
   Tiffany's phone ringing, then answer and press 1. Use a second
   caller to check waiting/FIFO, and let a caller wait three minutes to check
   voicemail. These checks ring a real phone.

Rollback routing by reverting the IVR option-1 change to its previous forwarding
flow and deploying. Leave the additive schema and voicemail evidence in place.
