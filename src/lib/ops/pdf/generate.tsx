import { renderToBuffer } from '@react-pdf/renderer'
import { InvoicePDF, type InvoicePDFData } from './invoice-pdf'

/**
 * Renders the invoice/receipt PDF to a Buffer.
 * Returns null (and logs the error) if rendering fails so callers can
 * degrade gracefully — the email still sends, just without an attachment.
 */
export async function generateInvoicePDF(
  data: InvoicePDFData,
): Promise<Buffer | null> {
  try {
    const buffer = await renderToBuffer(<InvoicePDF data={data} />)
    return Buffer.from(buffer)
  } catch (err) {
    console.error('[pdf/generate] Failed to render invoice PDF:', err)
    return null
  }
}
