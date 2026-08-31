/**
 * Which note belongs to which visit.
 *
 * Every day of a loss has its own note, and Charles said so plainly: *"the notes
 * are individual to the day... each entry is that day's entry."* Held as loose
 * component state the draft leaked — writing today's note and then opening
 * yesterday's showed today's text, because the draft outlived the visit it was
 * written for.
 *
 * Tagging an edit with its visit makes that impossible rather than unlikely.
 */

export type NoteEdit = { visitId: string; text: string } | null

/** What to show in the box: the edit if it is for THIS visit, else what is saved. */
export function noteTextFor(
  edit: NoteEdit,
  visit: { id: string; restoration_visit_note: string | null } | null,
): string {
  if (!visit) return ''
  if (edit && edit.visitId === visit.id) return edit.text
  return visit.restoration_visit_note ?? ''
}

/** Whether there is anything worth saving for this visit. */
export function noteIsDirty(
  edit: NoteEdit,
  visit: { id: string; restoration_visit_note: string | null } | null,
): boolean {
  if (!visit || !edit || edit.visitId !== visit.id) return false
  return edit.text.trim() !== (visit.restoration_visit_note ?? '').trim()
}
