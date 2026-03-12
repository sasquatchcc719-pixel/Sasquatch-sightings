# Harry Booking Destination Switch

## What It Does Right Now

- Adds a dashboard toggle: `Use Ops Booking Destination` (`booking_use_ops_link_enabled`).
- Toggle OFF (default): Harry sends `BOOKING_PUBLIC_URL` (or fallback website booking URL).
- Toggle ON: Harry sends `OPS_BOOKING_PUBLIC_URL` (or falls back to website URL if ops URL is not set).
- Applies to automated Harry SMS booking links in inbound Twilio conversation flow.
- Exposes active mode and URLs in Harry Control runtime panel for operator visibility.

## What It Does Not Do Yet

- Does not change website "Book Online" buttons or page-level CTAs.
- Does not change manual outbound SMS templates sent outside Harry auto-replies.
- Does not migrate Google "Book Online" integration by itself.
- Does not create the new ops booking UX endpoint; it only routes links once that URL exists.

## Safe Cutover Checklist

1. Build and verify the public ops booking page URL.
2. Set `OPS_BOOKING_PUBLIC_URL` in Vercel/Supabase environment.
3. Keep toggle OFF and test with internal conversations first.
4. Flip `Use Ops Booking Destination` ON in Harry Control.
5. Confirm new inbound booking replies point to ops URL.
6. Keep rollback ready by switching the toggle OFF.
