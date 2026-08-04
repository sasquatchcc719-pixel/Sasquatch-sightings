-- Job-completion email variant sent when the invoice includes a
-- "Urine Eliminator Treatment" line item. Seeded DISABLED so the copy can be
-- reviewed in the admin UI before it ever reaches a customer.

ALTER TABLE ops_communication_templates
DROP CONSTRAINT IF EXISTS ops_communication_templates_template_key_check;

ALTER TABLE ops_communication_templates
ADD CONSTRAINT ops_communication_templates_template_key_check
CHECK (
  template_key = ANY (ARRAY[
    'job_scheduled_sms'::text,
    'on_my_way_sms'::text,
    'job_finished_sms'::text,
    'job_rescheduled_sms'::text,
    'day_before_residential_sms'::text,
    'day_before_recovery_village_sms'::text,
    'job_scheduled_email'::text,
    'job_rescheduled_email'::text,
    'job_finished_email'::text,
    'job_finished_email_urine'::text,
    'satisfaction_checkin_email'::text
  ])
);

INSERT INTO ops_communication_templates (
  template_key,
  channel,
  label,
  is_enabled,
  subject_template,
  body_template,
  delay_hours
)
VALUES (
  'job_finished_email_urine',
  'email',
  'Finished job email (urine treatment)',
  false,
  $subject$Thank you from {{company_name}} — urine treatment care & what to expect$subject$,
  $body$Hi {{first_name}},

Thank you for choosing {{company_name}}! It was a pleasure serving you today and providing a Legendary Clean for your home.

Because today's service included a urine treatment, there are a few things worth knowing up front. Some of what you'll notice over the next day or two is completely normal — and in a couple of cases, it's exactly what we want to happen.

Post-Cleaning Care & Dry Times:

- Dry Time: While every home is different, carpets generally take 12 to 24 hours to dry completely. We recommend waiting the full 24 hours before moving heavy furniture back or walking on it with outdoor shoes.

- Airflow is Key: To speed things up, move air across the carpet fibers at floor level using ceiling fans or floor fans. Good airflow can sometimes drop dry times to just a few hours! One exception: leave the urine-treated areas alone and let them dry on their own schedule. The longer those stay damp, the more work the treatment does.

- Safety First: Please be extra careful when walking from the damp carpet onto hard surfaces like tile or wood—it will be very slippery!

The Smell Will Get Stronger Before It Gets Better — Give It 48 Hours

This is the part that catches people off guard, so we'd rather you hear it from us than wonder.

Dried urine is fairly quiet. The uric acid crystals sit dormant down in the fibers and backing, and a lot of the odor stays locked up with them. The moment we introduce moisture and treatment, those crystals reactivate and begin releasing ammonia as they break down. For the first several hours, the room may honestly smell stronger than it did before we arrived.

That isn't a step backward. That's the smell on its way out.

There's also a reason those areas stay damp longer than the rest of your carpet, and it's completely deliberate. Enzymes only work while they're wet. The moment the treatment dries out, the biological process stops cold. So on urine spots we intentionally apply far more product than a standard cleaning calls for and let it sit saturated — every additional hour it stays damp is another hour those enzymes spend breaking down what's soaked into the backing and pad.

If your treated areas dry slower than everything around them, that means we did the job right.

So here's the honest timeline: expect the odor to spike, then fall away steadily. Give it a full 48 hours before you judge the result. Ammonia continues off-gassing the entire time the area is drying, so the air won't truly clear until the carpet underneath is completely dry.

One thing we do to help you through it: on every urine job we run a deodorizer through our rinse water. That works on odor at the fiber surface and in the air, which takes the edge off during the worst of the transition while the enzymes handle the real work underneath.

Worth knowing up front: the deodorizer fades before the enzymes finish. If the smell seems to tick back up around the second day as it wears off, that isn't the treatment failing — the deodorizer was always the short-term comfort measure. The enzyme work happening down in the backing is what actually resolves it, and that's still going.

If a Spot Comes Back as It Dries, That's the Treatment Working

Urine never stays on the surface. It soaks through the face fiber into the backing, the pad, and sometimes the subfloor beneath. No carpet cleaning method — ours included — is built to extract directly from those lower layers.

What our treatment does is break that material down and mobilize it. Then, as the carpet dries, capillary action draws it up and out of the backing toward the tips of the fibers. That's called wicking, and it's why you might see a spot or a faint brown ring appear in a place that looked perfect when we packed up.

We intend for that to happen. It means contamination that was buried where nobody could reach it is now sitting at the surface where it can actually be removed. A spot that comes back up is a spot that's on its way out.

What to do about it: Once the carpet is fully dry, a thorough vacuuming is often all it takes — the residue lifts right off the fiber tips. If a ring is still visible after that, give us a call and we'll come back out to clear it — that follow-up is covered under our warranty, no charge.

Your Black Light Will Still Show It — Here's the Honest Reason

If you check the area with a UV light after treatment, you will almost certainly still see it glow. We want to explain that before it surprises you.

What fluoresces under UV isn't the odor, and it isn't bacteria. It's the uric acid salts, phosphates, and proteins left behind when urine dries. Those crystallize and bond chemically to the carpet fibers, and they also settle into the backing and pad where no surface cleaning reaches. They're mineral deposits, not living contamination.

We've inspected carpet where the urine was twenty years old and had been cleaned many times over, and it still lit up under UV. Eliminating the glow completely would mean replacing the carpet and pad, and often sealing the subfloor underneath.

What our treatment targets is the part that actually affects your home: the bacteria and organic compounds that cause odor. Judge the result with your nose, not with a black light.

One More Thing, Honestly

Every home responds a little differently, and we can't always predict that ahead of time. We've treated houses with hundreds of spots that cleared up completely, and we've treated houses with just a handful that never fully resolved. Cat urine tends to be the tougher of the two on average, but either one can be the exception, and there's no reliable way to know in advance which case we're dealing with.

What we can promise is that we're using the best tools, products, and techniques the industry has to offer, applied as carefully and professionally as we know how. In the rare case a spot doesn't fully resolve, it isn't for lack of effort — some situations are simply past what any cleaning can undo.

A Small Favor? As a local business, your feedback helps the Sasquatch grow! If you are thrilled with your clean, would you mind leaving us a quick review?

Leave a review here:
https://www.sasquatchcarpet.com/reviews

If anything is not 100% legendary, text us at (719) 249-8791 and we will make it right.

Thanks again for the business!
— {{company_name}}$body$,
  0
)
ON CONFLICT (template_key) DO UPDATE
SET
  channel = EXCLUDED.channel,
  label = EXCLUDED.label,
  is_enabled = EXCLUDED.is_enabled,
  subject_template = EXCLUDED.subject_template,
  body_template = EXCLUDED.body_template,
  delay_hours = EXCLUDED.delay_hours;
