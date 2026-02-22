import { NextRequest, NextResponse } from 'next/server'

/**
 * Serves the Sasquatch vCard so mobile browsers can open "Add to Contact"
 * instead of forcing a file download. Using a real URL + inline disposition
 * lets the OS handle the vCard (e.g. iOS/Android open the contact screen).
 */
export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get('code')?.trim() || 'SCC20'

  const vcard = `BEGIN:VCARD
VERSION:3.0
FN:Sasquatch Carpet Cleaning
ORG:Sasquatch Carpet Cleaning
TEL;TYPE=WORK,VOICE:719-249-8791
URL:https://sasquatchcarpet.com
NOTE:$20 OFF! Use code ${code} in booking notes.
END:VCARD`

  return new NextResponse(vcard, {
    status: 200,
    headers: {
      'Content-Type': 'text/vcard; charset=utf-8',
      'Content-Disposition': 'inline; filename="Sasquatch-Carpet-Cleaning.vcf"',
      'Cache-Control': 'public, max-age=3600',
    },
  })
}
