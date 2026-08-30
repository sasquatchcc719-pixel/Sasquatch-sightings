import { describe, expect, it } from 'vitest'
import { extractExifDate, parseExifDateTime } from './exif-capture-date'

describe('parseExifDateTime', () => {
  it('reads EXIF\'s colon-separated format as a local date', () => {
    const date = parseExifDateTime('2026:08:30 14:22:05')
    expect(date?.getFullYear()).toBe(2026)
    expect(date?.getMonth()).toBe(7) // August
    expect(date?.getDate()).toBe(30)
    expect(date?.getHours()).toBe(14)
  })

  it('does not roll a late-evening photo onto the next day', () => {
    // The whole point of parsing as local time rather than UTC.
    expect(parseExifDateTime('2026:08:31 23:30:00')?.getDate()).toBe(31)
  })

  it('rejects anything that is not a date', () => {
    expect(parseExifDateTime('')).toBeNull()
    expect(parseExifDateTime('not a date')).toBeNull()
    expect(parseExifDateTime('    ')).toBeNull()
  })
})

/** Minimal JPEG carrying a single DateTimeOriginal tag. */
function jpegWithExif(dateText: string): ArrayBuffer {
  const text = dateText + '\0'
  const tiffSize = 8 + 2 + 12 + 4 + text.length
  const exifSize = 6 + tiffSize
  const bytes = new Uint8Array(2 + 2 + 2 + exifSize)
  const view = new DataView(bytes.buffer)

  view.setUint16(0, 0xffd8) // SOI
  view.setUint16(2, 0xffe1) // APP1
  view.setUint16(4, 2 + exifSize) // segment size
  view.setUint32(6, 0x45786966) // "Exif"
  view.setUint16(10, 0) // padding

  const tiff = 12
  view.setUint16(tiff, 0x4d4d) // big endian
  view.setUint16(tiff + 2, 42)
  view.setUint32(tiff + 4, 8) // first IFD at tiff+8
  const ifd = tiff + 8
  view.setUint16(ifd, 1) // one entry
  view.setUint16(ifd + 2, 0x9003) // DateTimeOriginal
  view.setUint16(ifd + 4, 2) // ASCII
  view.setUint32(ifd + 6, text.length)
  const valueAt = ifd + 2 + 12 + 4
  view.setUint32(ifd + 10, valueAt - tiff)
  view.setUint32(ifd + 2 + 12, 0) // no next IFD
  for (let i = 0; i < text.length; i++) view.setUint8(valueAt + i, text.charCodeAt(i))

  return bytes.buffer
}

describe('extractExifDate', () => {
  it('finds DateTimeOriginal in a real JPEG structure', () => {
    const date = extractExifDate(jpegWithExif('2026:08:30 09:15:00'))
    expect(date?.getFullYear()).toBe(2026)
    expect(date?.getDate()).toBe(30)
    expect(date?.getHours()).toBe(9)
  })

  it('returns null for a file that is not a JPEG', () => {
    const notJpeg = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]).buffer
    expect(extractExifDate(notJpeg)).toBeNull()
  })

  it('returns null rather than throwing on a truncated file', () => {
    expect(extractExifDate(new Uint8Array([0xff, 0xd8]).buffer)).toBeNull()
    expect(extractExifDate(new ArrayBuffer(0))).toBeNull()
  })

  it('returns null for a JPEG with no EXIF block', () => {
    const bare = new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0x00, 0x02]).buffer
    expect(extractExifDate(bare)).toBeNull()
  })
})
