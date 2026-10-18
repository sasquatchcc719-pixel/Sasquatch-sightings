import path from 'node:path'
import sharp from 'sharp'
import { getServicePhoto, invoicePhotoService } from '@/lib/ops/service-photos'
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
    // Embed local JPEGs: React PDF cannot decode the catalog's WebP assets.
    const photos = new Map<string, Promise<string | undefined>>()
    const lineItems = await Promise.all(
      data.lineItems.map(async (item) => {
        const photo = getServicePhoto(invoicePhotoService(item))
        if (!photo) return { ...item, photo_data_url: undefined }
        if (!photos.has(photo.src)) {
          photos.set(
            photo.src,
            sharp(path.join(process.cwd(), 'public', photo.src))
              .resize(96, 96, {
                fit: photo.contain ? 'contain' : 'cover',
                background: '#ffffff',
              })
              .flatten({ background: '#ffffff' })
              .jpeg({ quality: 80 })
              .toBuffer()
              .then(
                (buffer) =>
                  `data:image/jpeg;base64,${buffer.toString('base64')}`,
              )
              .catch((error) => {
                console.error(
                  '[pdf/generate] Service photo unavailable:',
                  photo.src,
                  error,
                )
                return undefined
              }),
          )
        }
        return { ...item, photo_data_url: await photos.get(photo.src) }
      }),
    )
    const buffer = await renderToBuffer(
      <InvoicePDF data={{ ...data, lineItems }} />,
    )
    return Buffer.from(buffer)
  } catch (err) {
    console.error('[pdf/generate] Failed to render invoice PDF:', err)
    return null
  }
}
