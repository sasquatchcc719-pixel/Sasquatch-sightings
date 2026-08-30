/**
 * Reading a photo's capture time out of its EXIF.
 *
 * Bulk-uploading a backlog is only useful if each photo lands on the day it was
 * taken. The browser gives `File.lastModified`, which is usually right but is
 * wrong whenever a file has been copied, exported or edited since. EXIF
 * `DateTimeOriginal` is what the camera recorded and is preferred when present.
 *
 * Parsed by hand rather than with a dependency: the one tag needed sits in a
 * fixed place in the APP1 segment, and this avoids adding a library to the
 * client bundle for a single field.
 */

const JPEG_SOI = 0xffd8
const APP1 = 0xffe1
const EXIF_HEADER = 0x45786966 // "Exif"
const TAG_DATETIME_ORIGINAL = 0x9003
const TAG_DATETIME_DIGITIZED = 0x9004
const TAG_DATETIME = 0x0132
const TAG_EXIF_IFD_POINTER = 0x8769

/** "2026:08:30 14:22:05" — EXIF's own format, in the camera's local time. */
export function parseExifDateTime(value: string): Date | null {
  const m = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(value.trim())
  if (!m) return null
  const [, y, mo, d, h, mi, sec] = m.map(Number) as unknown as number[]
  const date = new Date(y, mo - 1, d, h, mi, sec)
  return Number.isNaN(date.getTime()) ? null : date
}

export function extractExifDate(buffer: ArrayBuffer): Date | null {
  const view = new DataView(buffer)
  if (view.byteLength < 4 || view.getUint16(0) !== JPEG_SOI) return null

  let offset = 2
  while (offset + 4 < view.byteLength) {
    const marker = view.getUint16(offset)
    const size = view.getUint16(offset + 2)
    if (size < 2) return null

    if (marker === APP1) {
      const start = offset + 4
      if (start + 10 > view.byteLength) return null
      if (view.getUint32(start) !== EXIF_HEADER) return null
      return readTiff(view, start + 6)
    }

    // Image data starts here; there is no EXIF beyond this point.
    if (marker === 0xffda) return null
    offset += 2 + size
  }
  return null
}

function readTiff(view: DataView, tiffStart: number): Date | null {
  if (tiffStart + 8 > view.byteLength) return null
  const endianMark = view.getUint16(tiffStart)
  const little = endianMark === 0x4949
  if (!little && endianMark !== 0x4d4d) return null

  const firstIfd = view.getUint32(tiffStart + 4, little)
  const found =
    readIfd(view, tiffStart, tiffStart + firstIfd, little) ??
    null
  return found
}

function readIfd(
  view: DataView,
  tiffStart: number,
  ifdStart: number,
  little: boolean,
  depth = 0,
): Date | null {
  if (depth > 2 || ifdStart + 2 > view.byteLength) return null
  const entries = view.getUint16(ifdStart, little)

  let subIfd: number | null = null
  let fallback: Date | null = null

  for (let i = 0; i < entries; i++) {
    const entry = ifdStart + 2 + i * 12
    if (entry + 12 > view.byteLength) break

    const tag = view.getUint16(entry, little)
    const count = view.getUint32(entry + 4, little)
    const valueOffset = view.getUint32(entry + 8, little)

    if (tag === TAG_EXIF_IFD_POINTER) {
      subIfd = tiffStart + valueOffset
      continue
    }

    if (
      tag === TAG_DATETIME_ORIGINAL ||
      tag === TAG_DATETIME_DIGITIZED ||
      tag === TAG_DATETIME
    ) {
      const start = tiffStart + valueOffset
      if (start + count > view.byteLength) continue
      let text = ''
      for (let c = 0; c < count - 1; c++) text += String.fromCharCode(view.getUint8(start + c))
      const parsed = parseExifDateTime(text)
      if (!parsed) continue
      // DateTimeOriginal is when the shutter fired; the others are weaker.
      if (tag === TAG_DATETIME_ORIGINAL) return parsed
      fallback = fallback ?? parsed
    }
  }

  if (subIfd != null) {
    const fromSub = readIfd(view, tiffStart, subIfd, little, depth + 1)
    if (fromSub) return fromSub
  }
  return fallback
}

/**
 * Best available capture time: EXIF if the file carries it, otherwise the
 * filesystem timestamp, which is right often enough to be worth using.
 */
export async function captureDateFor(file: File): Promise<Date | null> {
  try {
    // The EXIF block lives at the front; no need to read a 5 MB photo.
    const head = await file.slice(0, 128 * 1024).arrayBuffer()
    const exif = extractExifDate(head)
    if (exif) return exif
  } catch {
    // Unreadable EXIF is not a reason to refuse the upload.
  }
  return file.lastModified ? new Date(file.lastModified) : null
}
