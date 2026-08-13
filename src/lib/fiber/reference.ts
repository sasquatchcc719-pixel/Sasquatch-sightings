/**
 * Field reference for rug and upholstery identification.
 *
 * This is KNOWLEDGE, not enforcement. It is injected into the vision prompt so
 * the model reasons from what this trade actually knows instead of whatever it
 * happens to recall. Enforcement lives in stop-list.ts, which is deterministic
 * and cannot be talked out of a verdict.
 *
 * The split matters: this file can be broad and can go slightly stale without
 * anything becoming unsafe, because a wrong answer here still has to get past
 * the stop list. Researched against rug-industry and IICRC sources 2026-08-13.
 */

export const RUG_CONSTRUCTION_REFERENCE = `
RUG CONSTRUCTION — the damage that has nothing to do with face fiber

A rug can be made of a perfectly cleanable fiber and still be destroyed by how
it was built. Always judge construction as well as fiber.

HAND-TUFTED (the big one, and very common)
- Yarn punched through a canvas foundation with a tufting gun, then held in
  place by a LATEX ADHESIVE layer, usually hidden under a cloth scrim backing.
- Water breaks that latex down. It delaminates, the scrim separates, and the
  rug sheds for the rest of its life. Old latex also smells strongly of wet
  cardboard or "dirty socks" once wet — an odour customers blame on the
  cleaner.
- Tells: a cloth scrim glued across the whole back hiding the knots; a stiff
  rubbery feel; white or yellow crumbs when you scratch the back; you cannot
  see the pattern from the back.
- Verdict: LOW MOISTURE AT MOST. Never saturate, never hot rinse. Say so out
  loud even when the face fiber is wool.

HAND-KNOTTED
- Knots tied around warp threads; the pattern is visible from the back and the
  fringe is an extension of the foundation, not sewn on.
- Structurally the most robust, but usually the most valuable and the most
  likely to carry unstable dyes. Dye testing matters more than fiber here.

MACHINE-MADE / POWER-LOOMED
- Uniform, machine-perfect back, often with a stiff sizing. Usually
  polypropylene, polyester or viscose.
- The construction is fine; the risk is that the modern silky-looking ones are
  viscose.

FLATWEAVE / DHURRIE / KILIM
- No pile, reversible, often cotton or wool, sometimes jute.
- Risk is shrinkage, dye bleed and cellulosic browning rather than pile damage.

BRAIDED
- Strips stitched together. Wet cleaning can pop the stitching and the braid
  can shrink at a different rate than the thread.

HOOKED
- Loops pulled through a foundation, often with a glued back. Treat like
  hand-tufted.

SHAG / HIGH PILE
- Fibre length hides enormous soil loads and holds water. Drying is the whole
  problem; matting on drying is common.

SHEEPSKIN / HIDE / COWHIDE
- Leather backing. Water stiffens and shrinks the hide permanently. Not a
  wet-clean item.
`

export const RUG_BACKING_REFERENCE = `
RUG BACKINGS AND FOUNDATIONS

- LATEX (tufted rugs): degrades with water and age. Delamination, shedding,
  odour. The most common construction-driven failure.
- JUTE backing or foundation: browns readily and bleeds that brown UP into the
  face fibre. A wool rug on a jute foundation can brown even though wool does
  not.
- COTTON foundation (most hand-knotted): cellulosic. Browns and wicks; the
  fringe is usually cotton and yellows first.
- FELT / NEEDLE-PUNCH: holds water badly, slow to dry, can bleed its own dye.
- PVC / TPE / TPR / rubber non-slip backings: stiffen, crack and can mark or
  discolour the floor beneath when wet. Common on cheap kitchen and bath rugs.
- CANVAS SCRIM: the giveaway for tufted construction.

If the back cannot be seen, ask the tech to fold a corner and look. What is on
the back changes the answer as often as what is on the face.
`

export const UPHOLSTERY_REFERENCE = `
UPHOLSTERY — CLEANING CODES (usually on a tag under a cushion or the deck)

- W       Water-based cleaning is acceptable.
- S       SOLVENT ONLY. Water causes rings, shrinkage and dye bleed.
- WS / SW / W-S  Either water or solvent, but still test first.
- X       VACUUM ONLY. No water, no solvent, nothing wet at all.
- W/S/B   Water, solvent, or bleach-tolerant (rare; usually a performance fabric).

A missing code is not permission. Identify the fibre instead.

X-code fabrics are typically crushed velvet, glazed chintz, moiré, and raw silk
with non-colourfast embroidery — fabrics where the FINISH is the fragile part.

FABRICS THAT NEED CARE FOR REASONS OTHER THAN FIBRE
- VELVET / VELOUR / CRUSHED VELVET: pile crushes and watermarks permanently.
  Any moisture must be minimal and the pile must be groomed in one direction
  while drying. Crushed velvet and glazed finishes are usually X.
- CHENILLE: the pile distorts and mats; a great deal of chenille is rayon, so
  suspect viscose. Chenille with an S code must not see water.
- LINEN and LINEN BLENDS: browning, shrinkage, watermarking.
- SILK / RAW SILK: specialist only.
- LEATHER, BONDED LEATHER, "VEGAN LEATHER" (PU): never wet clean. Bonded
  leather peels regardless of what you do; say so before touching it so the
  customer does not blame the cleaning.
- HAITIAN COTTON: notorious for browning. Assume it will brown.
- OUTDOOR / SOLUTION-DYED ACRYLIC: very forgiving, tolerates more than most.

PERFORMANCE FABRIC BRANDS (a brand on a tag is not a fibre content)
- CRYPTON: moisture-barrier backed, made from many different fibres — cotton,
  linen, olefin, polyester. Water-based cleaning and hot water extraction are
  fine. NEVER use bleach or solvents on Crypton.
- SUNBRELLA: solution-dyed acrylic. Very durable, air dry only, and it DOES
  tolerate a dilute bleach solution for stubborn stains — the exception, not
  the rule.
- REVOLUTION: olefin/polypropylene. Bleach-cleanable, heat sensitive.
- NANOTEX / INSIDEOUT and similar treatments: a finish on an unknown base
  fibre. Identify the base fibre, do not trust the brand alone.

When a tag shows only a brand, look it up rather than guessing — the same brand
covers fabrics with opposite cleaning requirements.
`

export const DYE_RISK_REFERENCE = `
DYE STABILITY — the other way a rug dies

Fibre can be perfectly cleanable while the DYES are not. Fibre identification
does not clear a rug for water.

HIGH RISK OF BLEEDING
- Hand-made rugs from India, Pakistan, China, Turkey, Iran, Afghanistan.
- Deep reds, maroons, oranges, navy and black next to cream or ivory.
- Village and tribal rugs dyed by hand without mordants to fix the colour.
- Anything previously "cleaned" by a homeowner with a rental machine.
- Silk and cotton bleed worse and correct worse than wool.

THE TEST — always, before any water on a hand-made or unknown rug
1. Damp a WHITE towel with the actual solution you intend to use, not plain
   water.
2. Press it firmly on each colour separately, especially every dark colour
   sitting next to a light one.
3. Look at the towel. Any colour transfer at all means do not wet clean on
   site.
Repeat per colour and in more than one area — dyes vary across the same rug.

OVER-WETTING IS THE USUAL CAUSE. Dye that would have been stable under light
moisture will run when the rug is saturated and the water carries it.
`

/** Everything above, for injection into the vision prompt. */
export const FIBER_FIELD_REFERENCE = [
  RUG_CONSTRUCTION_REFERENCE,
  RUG_BACKING_REFERENCE,
  UPHOLSTERY_REFERENCE,
  DYE_RISK_REFERENCE,
].join('\n')
