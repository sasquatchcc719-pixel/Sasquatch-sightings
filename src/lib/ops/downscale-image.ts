/**
 * Shrink a photo in the browser before it is uploaded.
 *
 * A phone photo is 3–8 MB. The upload route resizes everything to 1920px
 * anyway, so every one of those megabytes is carried across a job-site
 * connection, held in a serverless request body, and decoded by Sharp — for a
 * result identical to sending 400 KB.
 *
 * That waste had teeth: Vercel caps a serverless request body at 4.5 MB and the
 * function at its duration limit, so a batch of larger photos spun and then
 * failed with nothing to show for it, while smaller ones from the same phone
 * went through. Charles hit exactly that — arrival photos uploaded, demolition
 * photos did not.
 *
 * The capture date must be read from the ORIGINAL file before this runs: a
 * canvas re-encode drops EXIF, which is what dates a backlog onto the right day.
 */

const MAX_EDGE = 1920
const QUALITY = 0.82
/** Below this, re-encoding costs more than it saves. */
const SKIP_UNDER_BYTES = 600_000

export async function downscaleImage(file: File): Promise<File> {
  if (typeof document === 'undefined') return file
  if (!file.type.startsWith('image/')) return file
  if (file.size <= SKIP_UNDER_BYTES) return file

  try {
    const bitmap = await loadBitmap(file)
    if (!bitmap) return file

    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height))
    const width = Math.round(bitmap.width * scale)
    const height = Math.round(bitmap.height * scale)

    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    if (!context) return file
    context.drawImage(bitmap, 0, 0, width, height)
    if ('close' in bitmap) bitmap.close()

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', QUALITY),
    )
    // Never send something larger than what we were given.
    if (!blob || blob.size >= file.size) return file

    return new File([blob], jpegName(file.name), {
      type: 'image/jpeg',
      lastModified: file.lastModified,
    })
  } catch {
    // A format the browser cannot decode (some HEIC) still uploads as it is —
    // worse, but never worse than failing.
    return file
  }
}

async function loadBitmap(file: File): Promise<ImageBitmap | HTMLImageElement | null> {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file)
    } catch {
      // Fall through to the <img> path.
    }
  }

  return new Promise((resolve) => {
    const url = URL.createObjectURL(file)
    const image = new Image()
    image.onload = () => {
      URL.revokeObjectURL(url)
      resolve(image)
    }
    image.onerror = () => {
      URL.revokeObjectURL(url)
      resolve(null)
    }
    image.src = url
  })
}

function jpegName(name: string): string {
  return name.replace(/\.[^.]+$/, '') + '.jpg'
}
