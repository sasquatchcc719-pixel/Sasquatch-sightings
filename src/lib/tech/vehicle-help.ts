export type VehicleHelpKind = 'roadside' | 'tow' | 'repair'
export type VehicleKind = 'box-truck' | 'other'

export type PickupLocation = {
  latitude: number
  longitude: number
  accuracy: number
  capturedAt: number
}

export const BOX_TRUCK =
  '2007 Ford E-350 box truck (former Penske moving truck)'

// This is David's runbook, including when Charles opens it from his account.
export const DRIVER_INTRODUCTION =
  'I’m David. I work for Charles Sewell at Sasquatch Carpet Cleaning. The account may be under Charles Sewell. Please bill and issue all paperwork to Sasquatch Carpet Cleaning. This is a business expense.'

// Contacts supplied by Charles; phone numbers verified against provider sites.
// The repair address is from Charles's Google Maps listing, September 9, 2026.
export const VEHICLE_CONTACTS = {
  roadside: {
    name: 'Beast Off-road & Recovery',
    person: 'Jeff',
    phone: '(719) 412-1068',
    href: 'tel:+17194121068',
    website: 'https://beastoffroadrecovery.com/',
    role: 'Flat tire, dead battery, stuck vehicle, or roadside help',
    relationship: 'Jeff is a friend of Charles and is familiar with our truck.',
  },
  tow: {
    name: 'Randy’s High Country Towing',
    person: 'Dispatch',
    phone: '(719) 596-6067',
    href: 'tel:+17195966067',
    website: 'https://randystowing.net/',
    role: 'Our towing company for the large box truck',
    relationship:
      'Randy’s has towed our box truck before. Confirm the right equipment on every call.',
  },
  repair: {
    name: 'Mountain Motorsport',
    person: 'Matt',
    phone: '(719) 300-7119',
    href: 'tel:+17193007119',
    website: 'https://www.mountainmotorsport.org/',
    role: 'Our mechanic and emergency repair destination',
    relationship:
      'Matt is a friend of Charles. The shop knows our equipment and is the planned emergency repair destination.',
  },
} as const

export const REPAIR_ADDRESS = '2522 E Platte Ave, Colorado Springs, CO 80909'
export const REPAIR_APPLE_MAP = `https://maps.apple.com/?daddr=${encodeURIComponent(REPAIR_ADDRESS)}&dirflg=d`

export function pickupMapUrl(location: PickupLocation): string {
  return `https://www.google.com/maps/search/?api=1&query=${location.latitude.toFixed(6)},${location.longitude.toFixed(6)}`
}

export function formatCaptureTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'America/Denver',
    timeZoneName: 'short',
  })
}

export function buildVehicleHelpMessage(input: {
  kind: Exclude<VehicleHelpKind, 'repair'>
  vehicle: VehicleKind
  otherVehicle: string
  callback: string
  issue: string
  location: PickupLocation | null
  manualLocation: string
  landmarks: string
}): string {
  const { kind, vehicle, location } = input
  const greeting = kind === 'roadside' ? 'Hi Jeff,' : 'Hello,'
  const need = kind === 'roadside' ? 'roadside assistance' : 'a tow'
  const lines = [
    `${greeting} ${DRIVER_INTRODUCTION} We need ${need}.`,
    `Vehicle: ${vehicle === 'box-truck' ? BOX_TRUCK : input.otherVehicle.trim() || 'Other company vehicle — confirm details by phone'}.`,
    `Problem: ${input.issue.trim() || 'I will describe the problem by phone.'}`,
    `Callback: ${input.callback.trim() || 'Confirm my callback number by phone.'}`,
  ]
  if (location) {
    lines.push(
      `Pickup GPS: ${location.latitude.toFixed(6)}, ${location.longitude.toFixed(6)}`,
      `Pickup map: ${pickupMapUrl(location)}`,
      `GPS captured ${formatCaptureTime(location.capturedAt)}; estimated accuracy ±${Math.ceil(location.accuracy)} m. Confirm this pin matches the stopped vehicle.`,
    )
  } else {
    lines.push(
      `Pickup location: ${input.manualLocation.trim() || 'Not yet provided — confirm before dispatch.'}`,
    )
  }
  lines.push(
    `Road / direction / landmark: ${input.landmarks.trim() || 'Confirm road, direction of travel, and nearest exit or landmark by phone.'}`,
  )
  if (kind === 'tow') {
    if (vehicle === 'box-truck') {
      lines.push(
        'Randy’s has towed this box truck before. Please confirm you are sending equipment capable of handling its size and loaded weight. I can confirm the vehicle label/specifications by phone.',
      )
    } else {
      lines.push(
        'Please confirm your equipment is suitable for this vehicle before dispatch.',
      )
    }
    lines.push(
      `Requested repair destination: Mountain Motorsport, ${REPAIR_ADDRESS}. Call Matt at ${VEHICLE_CONTACTS.repair.phone} to confirm intake and drop-off instructions before delivery.`,
    )
  }
  lines.push(
    'Please repeat the exact pickup location back to me, including the correct side of the road, and confirm the ETA and callback number.',
  )
  return lines.join('\n\n')
}
