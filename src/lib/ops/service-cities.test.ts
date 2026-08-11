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

  it('never throws away a zip from outside the towns we work', () => {
    // Nothing we offer could have produced these, so they were typed on purpose.
    expect(nextZipForCityPick('80809', city('Monument'))).toBe('80809')
    expect(nextZipForCityPick('81212', city('Colorado Springs'))).toBe('81212')
  })

  it('keeps a zip that already belongs to the town being picked', () => {
    expect(nextZipForCityPick('80921', city('Colorado Springs'))).toBe('80921')
    expect(nextZipForCityPick('80104', city('Castle Rock'))).toBe('80104')
    expect(nextZipForCityPick('80132', city('Monument'))).toBe('80132')
  })

  it('corrects a zip belonging to a different town we work', () => {
    // 80921 is a Colorado Springs zip — on a Monument job it is wrong however
    // it got there, now that the zip buttons can produce it as easily as typing.
    expect(nextZipForCityPick('80921', city('Monument'))).toBe('80132')
    expect(nextZipForCityPick('80104', city('Colorado Springs'))).toBe('')
  })

  it('leaves the zip empty for a multi-zip town rather than guessing', () => {
    expect(nextZipForCityPick('', city('Colorado Springs'))).toBe('')
    expect(nextZipForCityPick('', city('Castle Rock'))).toBe('')
  })
})
