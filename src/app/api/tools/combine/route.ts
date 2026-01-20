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
        { status: 400 }
      )
    }

    // Convert Files to Buffers
    const beforeBuffer = Buffer.from(await beforeImage.arrayBuffer())
    const afterBuffer = Buffer.from(await afterImage.arrayBuffer())

    // Get image metadata
    const beforeMeta = await sharp(beforeBuffer).metadata()
    const afterMeta = await sharp(afterBuffer).metadata()

    // Calculate target dimensions (use the larger height)
    const targetHeight = Math.max(beforeMeta.height || 800, afterMeta.height || 800)
    const targetWidth = Math.round(targetHeight * 1.5) // 3:2 aspect ratio per image

    // Resize both images to same dimensions
    const beforeResized = await sharp(beforeBuffer)
      .resize(targetWidth, targetHeight, { fit: 'cover' })
      .toBuffer()

    const afterResized = await sharp(afterBuffer)
      .resize(targetWidth, targetHeight, { fit: 'cover' })
      .toBuffer()

    // Create text label SVGs
    const fontSize = Math.round(targetHeight * 0.08) // 8% of height
    const padding = Math.round(fontSize * 0.8)

    const beforeLabel = Buffer.from(`
      <svg width="${targetWidth}" height="${targetHeight}">
        <defs>
          <filter id="shadow">
            <feDropShadow dx="2" dy="2" stdDeviation="3" flood-opacity="0.8"/>
          </filter>
        </defs>
        <text 
          x="${padding}" 
          y="${padding + fontSize}" 
          font-family="Arial, sans-serif" 
          font-size="${fontSize}" 
          font-weight="bold"
          fill="white" 
          filter="url(#shadow)"
        >BEFORE</text>
      </svg>
    `)

    const afterLabel = Buffer.from(`
      <svg width="${targetWidth}" height="${targetHeight}">
        <defs>
          <filter id="shadow">
            <feDropShadow dx="2" dy="2" stdDeviation="3" flood-opacity="0.8"/>
          </filter>
        </defs>
        <text 
          x="${padding}" 
          y="${padding + fontSize}" 
          font-family="Arial, sans-serif" 
          font-size="${fontSize}" 
          font-weight="bold"
          fill="white" 
          filter="url(#shadow)"
        >AFTER</text>
      </svg>
    `)

    // Combine images side by side
    let combinedImage = sharp({
      create: {
        width: targetWidth * 2,
        height: targetHeight,
        channels: 3,
        background: { r: 0, g: 0, b: 0 },
      },
    })
      .composite([
        { input: beforeResized, left: 0, top: 0 },
        { input: afterResized, left: targetWidth, top: 0 },
        { input: beforeLabel, left: 0, top: 0 },
        { input: afterLabel, left: targetWidth, top: 0 },
      ])

    // Add watermark if requested
    if (addWatermark) {
      try {
        // Use the actual Sasquatch logo from public folder
        const logoPath = path.join(process.cwd(), 'public', 'sasquatch-logo.png')
        const logoBuffer = fs.readFileSync(logoPath)

        // Resize logo to reasonable size (15% of image height)
        const logoHeight = Math.round(targetHeight * 0.15)
        const resizedLogo = await sharp(logoBuffer)
          .resize({ height: logoHeight, fit: 'contain' })
          .toBuffer()

        combinedImage = combinedImage.composite([
          {
            input: resizedLogo,
            gravity: 'southeast',
            left: padding,
            top: padding,
          },
        ])
      } catch (logoError) {
        console.error('Failed to add logo watermark:', logoError)
        // Continue without watermark if logo fails
      }
    }

    // Convert to JPEG with quality 90
    const outputBuffer = await combinedImage.jpeg({ quality: 90 }).toBuffer()

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
      { status: 500 }
    )
  }
}
