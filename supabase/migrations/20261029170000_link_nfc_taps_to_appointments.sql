ALTER TABLE public.nfc_card_taps
  ADD COLUMN IF NOT EXISTS appointment_id UUID
  REFERENCES public.ops_appointments(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS nfc_card_taps_appointment_unique
  ON public.nfc_card_taps (appointment_id)
  WHERE appointment_id IS NOT NULL;

COMMENT ON COLUMN public.nfc_card_taps.appointment_id IS
  'Successful online booking created from this exact NFC tap.';
