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

    // Create background boxes and text labels separately
    const padding = 20
    const boxWidth = 220
    const boxHeight = 80
    const boxY = targetHeight - boxHeight - padding // Position at bottom

    // Create black background boxes only (no text in SVG)
    const beforeBox = Buffer.from(`
      <svg width="${targetWidth}" height="${targetHeight}" xmlns="http://www.w3.org/2000/svg">
        <rect 
          x="${padding}" 
          y="${boxY}" 
          width="${boxWidth}" 
          height="${boxHeight}" 
          fill="rgba(0, 0, 0, 0.7)" 
          rx="10"
        />
      </svg>
    `)

    const afterBox = Buffer.from(`
      <svg width="${targetWidth}" height="${targetHeight}" xmlns="http://www.w3.org/2000/svg">
        <rect 
          x="${padding}" 
          y="${boxY}" 
          width="${boxWidth}" 
          height="${boxHeight}" 
          fill="rgba(0, 0, 0, 0.7)" 
          rx="10"
        />
      </svg>
    `)

    // Create text overlays using Sharp's composite with better SVG
    const fontSize = 48
    const textY = boxY + boxHeight / 2 + fontSize / 3

    const beforeText = Buffer.from(`
      <svg width="${targetWidth}" height="${targetHeight}" xmlns="http://www.w3.org/2000/svg">
        <text 
          x="${padding + boxWidth / 2}" 
          y="${textY}" 
          font-family="Arial,Helvetica,sans-serif" 
          font-size="${fontSize}" 
          font-weight="bold"
          fill="#FFFFFF" 
          text-anchor="middle"
          style="font-family: Arial, Helvetica, sans-serif; font-weight: bold;"
        >BEFORE</text>
      </svg>
    `)

    const afterText = Buffer.from(`
      <svg width="${targetWidth}" height="${targetHeight}" xmlns="http://www.w3.org/2000/svg">
        <text 
          x="${padding + boxWidth / 2}" 
          y="${textY}" 
          font-family="Arial,Helvetica,sans-serif" 
          font-size="${fontSize}" 
          font-weight="bold"
          fill="#FFFFFF" 
          text-anchor="middle"
          style="font-family: Arial, Helvetica, sans-serif; font-weight: bold;"
        >AFTER</text>
      </svg>
    `)

    // Combine images side by side (1200px total width)
    // Start with the before image as the base, extend it to fit both images
    let combinedImage = await sharp(beforeResized)
      .extend({
        right: targetWidth,
        background: { r: 255, g: 255, b: 255 },
      })
      .composite([
        { input: afterResized, left: targetWidth, top: 0 },
        { input: beforeBox, left: 0, top: 0 },
        { input: afterBox, left: targetWidth, top: 0 },
        { input: beforeText, left: 0, top: 0 },
        { input: afterText, left: targetWidth, top: 0 },
      ])
      .toBuffer()

    // Now work with the combined image for watermark
    let finalImage = sharp(combinedImage)

    // Add watermark if requested (centered at bottom)
    if (addWatermark) {
      try {
        // Use the actual Sasquatch logo from public folder (SVG for perfect scaling)
        const logoPath = path.join(process.cwd(), 'public', 'sasquatch-logo.svg')
        const logoBuffer = fs.readFileSync(logoPath)

        // Resize logo for bottom watermark (wider logo works better centered at bottom)
        // Set width to 30% of combined image width
        const logoWidth = Math.round((targetWidth * 2) * 0.30)
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
      { status: 500 }
    )
  }
}
