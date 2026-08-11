import { describe, expect, it } from 'vitest'
import { nextZipForCityPick, SERVICE_CITIES } from './service-cities'

const city = (name: string) => {
  const found = SERVICE_CITIES.find((entry) => entry.city === name)
  if (!found) throw new Error(`no service city named ${name}`)
  return found
}

describe('nextZipForCityPick', () => {
  it('fills the zip for a single-zip town when the field is empty', () => {
    expect(nextZipForCityPick('', city('Monument'))).toBe('80132')
    expect(nextZipForCityPick('   ', city('Palmer Lake'))).toBe('80133')
    expect(nextZipForCityPick(null, city('Larkspur'))).toBe('80118')
  })

  it('corrects a zip a previous tap filled in', () => {
    // Tap Monument, then realise it is Larkspur: zip must follow, not stay 80132.
    expect(nextZipForCityPick('80132', city('Larkspur'))).toBe('80118')
    expect(nextZipForCityPick('80118', city('Palmer Lake'))).toBe('80133')
  })

  it('clears a previous tap’s zip when switching to a multi-zip town', () => {
    expect(nextZipForCityPick('80132', city('Colorado Springs'))).toBe('')
    expect(nextZipForCityPick('80118', city('Castle Rock'))).toBe('')
  })

  it('never throws away a hand-typed zip', () => {
    expect(nextZipForCityPick('80921', city('Monument'))).toBe('80921')
    expect(nextZipForCityPick('80921', city('Colorado Springs'))).toBe('80921')
    expect(nextZipForCityPick('80104', city('Castle Rock'))).toBe('80104')
  })

  it('leaves the zip empty for a multi-zip town rather than guessing', () => {
    expect(nextZipForCityPick('', city('Colorado Springs'))).toBe('')
    expect(nextZipForCityPick('', city('Castle Rock'))).toBe('')
  })
})
