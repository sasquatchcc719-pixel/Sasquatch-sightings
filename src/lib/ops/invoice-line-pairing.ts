/**
 * Pair an appointment's line items with the invoice lines that already exist
 * for them.
 *
 * The two tables are not reliably linked. The booking widget writes the
 * invoice lines and the appointment lines as two independent sets, so on a
 * widget-booked job every invoice line has a null appointment_line_item_id.
 * Matching on that column alone therefore finds nothing, every appointment
 * line looks like it still needs an invoice line, and the caller inserts a
 * second copy of the whole job — doubling the total.
 *
 * So: match on the link when there is one, and otherwise adopt an unlinked
 * invoice line describing the same work. Only a line with nothing to adopt is
 * genuinely new.
 */

export type ExistingInvoiceLine = {
  id: string
  appointment_line_item_id: string | null
  description: string | null
}

export type AppointmentLineRef = {
  id: string
  name_snapshot?: string | null
}

export type LinePairing = {
  /** The appointment line this decision is for. */
  appointmentLineId: string
  /**
   * The invoice line to update, or null when one has to be inserted. When this
   * came from adopting an unlinked line, the caller should also write the
   * link so the guesswork only happens once.
   */
  invoiceLineId: string | null
  adopted: boolean
}

export function pairInvoiceLines(
  appointmentLines: AppointmentLineRef[],
  existingInvoiceLines: ExistingInvoiceLine[],
): LinePairing[] {
  const linkedByAppointmentLine = new Map<string, string>()
  const unlinked: Array<{ id: string; description: string }> = []

  for (const row of existingInvoiceLines) {
    if (row.appointment_line_item_id) {
      linkedByAppointmentLine.set(
        String(row.appointment_line_item_id),
        String(row.id),
      )
    } else {
      unlinked.push({
        id: String(row.id),
        description: String(row.description ?? ''),
      })
    }
  }

  const adoptedIds = new Set<string>()

  return appointmentLines.map((line) => {
    const linked = linkedByAppointmentLine.get(String(line.id)) ?? null
    if (linked) {
      return {
        appointmentLineId: String(line.id),
        invoiceLineId: linked,
        adopted: false,
      }
    }

    // Two rooms of the same name are two separate lines, so a line can only be
    // adopted once.
    const adoptable = unlinked.find(
      (row) =>
        !adoptedIds.has(row.id) &&
        row.description === String(line.name_snapshot ?? ''),
    )
    if (adoptable) {
      adoptedIds.add(adoptable.id)
      return {
        appointmentLineId: String(line.id),
        invoiceLineId: adoptable.id,
        adopted: true,
      }
    }

    return {
      appointmentLineId: String(line.id),
      invoiceLineId: null,
      adopted: false,
    }
  })
}
