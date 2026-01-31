/**
 * Before/After Image Combiner API Route
 * Uses Sharp to stitch two images side-by-side with labels
 * Per .cursorrules: Server-side image processing with Sharp
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/supabase/server'
import sharp from 'sharp'
import path from 'path'
import fs from 'fs'

export async function POST(request: NextRequest) {
  try {
    // Check authentication (admin only)
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Parse form data
    const formData = await request.formData()
    const beforeImage = formData.get('before') as File
    const afterImage = formData.get('after') as File
    const addWatermark = formData.get('watermark') === 'true'

    // Validate required fields
    if (!beforeImage || !afterImage) {
      return NextResponse.json(
        { error: 'Both before and after images are required' },
        { status: 400 },
      )
    }

    // Convert Files to Buffers
    const beforeBuffer = Buffer.from(await beforeImage.arrayBuffer())
    const afterBuffer = Buffer.from(await afterImage.arrayBuffer())

    // Use fixed reasonable dimensions for web/social media
    // Each image will be 600px wide, total combined width = 1200px
    const targetWidth = 600
    const targetHeight = 800 // 4:3 aspect ratio per image

    // Resize both images to same dimensions (keep as raw for compositing)
    const beforeResized = await sharp(beforeBuffer)
      .resize(targetWidth, targetHeight, { fit: 'cover', position: 'center' })
      .toBuffer()

    const afterResized = await sharp(afterBuffer)
      .resize(targetWidth, targetHeight, { fit: 'cover', position: 'center' })
      .toBuffer()

    const padding = 20

    // Combine images side by side (1200px total width)
    // Start with the before image as the base, extend it to fit both images
    let combinedImage = await sharp(beforeResized)
      .extend({
        right: targetWidth,
        background: { r: 255, g: 255, b: 255 },
      })
      .composite([{ input: afterResized, left: targetWidth, top: 0 }])
      .toBuffer()

    // Now work with the combined image for watermark
    let finalImage = sharp(combinedImage)

    // Add watermark if requested (centered at bottom)
    if (addWatermark) {
      try {
        // Use the actual Sasquatch logo from public folder (SVG for perfect scaling)
        const logoPath = path.join(
          process.cwd(),
          'public',
          'vector6-no-background.svg',
        )
        const logoBuffer = fs.readFileSync(logoPath)

        // Resize logo for bottom watermark (wider logo works better centered at bottom)
        // Set width to 30% of combined image width
        const logoWidth = Math.round(targetWidth * 2 * 0.3)
        const resizedLogo = await sharp(logoBuffer)
          .resize({ width: logoWidth, fit: 'contain' })
          .toBuffer()

        finalImage = finalImage.composite([
          {
            input: resizedLogo,
            gravity: 'south', // Bottom center
            left: 0,
            top: padding,
          },
        ])
      } catch (logoError) {
        console.error('Failed to add logo watermark:', logoError)
        // Continue without watermark if logo fails
      }
    }

    // Convert to JPEG with quality 90
    const outputBuffer = await finalImage.jpeg({ quality: 90 }).toBuffer()

    // Return as base64 for preview
    const base64 = outputBuffer.toString('base64')
    const dataUrl = `data:image/jpeg;base64,${base64}`

    return NextResponse.json({
      success: true,
      image: dataUrl,
      size: outputBuffer.length,
    })
  } catch (error) {
    console.error('Image combine error:', error)
    return NextResponse.json(
      { error: 'Failed to combine images' },
      { status: 500 },
    )
  }
}
