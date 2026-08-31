// @vitest-environment jsdom
/**
 * The browser-side shrink that stands between a phone photo and a 4.5 MB
 * serverless request body.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { downscaleImage } from './downscale-image'

function fileOf(bytes: number, type = 'image/jpeg', name = 'IMG_0001.HEIC') {
  return new File([new Uint8Array(bytes)], name, { type })
}

beforeEach(() => {
  vi.unstubAllGlobals()
})

describe('downscaleImage', () => {
  it('leaves a small photo alone — re-encoding would cost more than it saves', async () => {
    const small = fileOf(100_000)
    expect(await downscaleImage(small)).toBe(small)
  })

  it('leaves anything that is not an image alone', async () => {
    const pdf = fileOf(5_000_000, 'application/pdf', 'scope.pdf')
    expect(await downscaleImage(pdf)).toBe(pdf)
  })

  it('returns the original when the browser cannot decode it', async () => {
    // Some HEIC. Failing to shrink is worse than shrinking; failing to upload
    // is worse than both.
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn().mockRejectedValue(new Error('unsupported')),
    )
    const heic = fileOf(4_000_000, 'image/heic')
    const result = await downscaleImage(heic)
    expect(result).toBe(heic)
  })

  it('shrinks a large photo and hands back a jpeg', async () => {
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn().mockResolvedValue({ width: 4032, height: 3024, close: vi.fn() }),
    )
    const drawImage = vi.fn()
    const toBlob = vi.fn((cb: (b: Blob | null) => void) =>
      cb(new Blob([new Uint8Array(320_000)], { type: 'image/jpeg' })),
    )
    vi.spyOn(document, 'createElement').mockReturnValue({
      width: 0,
      height: 0,
      getContext: () => ({ drawImage }),
      toBlob,
    } as unknown as HTMLCanvasElement)

    const big = fileOf(6_000_000, 'image/jpeg', 'IMG_2201.jpg')
    const result = await downscaleImage(big)

    expect(result.size).toBeLessThan(big.size)
    expect(result.type).toBe('image/jpeg')
    expect(result.name).toBe('IMG_2201.jpg')
    // Longest edge capped at 1920: 4032x3024 becomes 1920x1440.
    expect(drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 1920, 1440)
    vi.restoreAllMocks()
  })

  it('keeps the original if the re-encode came out bigger', async () => {
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn().mockResolvedValue({ width: 800, height: 600, close: vi.fn() }),
    )
    vi.spyOn(document, 'createElement').mockReturnValue({
      width: 0,
      height: 0,
      getContext: () => ({ drawImage: vi.fn() }),
      toBlob: (cb: (b: Blob | null) => void) =>
        cb(new Blob([new Uint8Array(9_000_000)], { type: 'image/jpeg' })),
    } as unknown as HTMLCanvasElement)

    const file = fileOf(1_000_000)
    expect(await downscaleImage(file)).toBe(file)
    vi.restoreAllMocks()
  })
})
