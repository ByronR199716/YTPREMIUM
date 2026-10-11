import { describe, expect, it } from 'bun:test'
import { getSettingsSnapshot, normalizeSettings, type SettingsSnapshot } from './settings'

const normalizePartialSettings = () => normalizeSettings<Partial<SettingsSnapshot>>({})

describe('settings', () => {
  it('defaults original video title setting off in snapshots', () => {
    expect(getSettingsSnapshot({}).showOriginalVideoTitle).toBe(false)
  })

  // YTPremium: en el celular "Mostrar No me gusta" viene activado.
  it('defaults show dislikes setting on in snapshots', () => {
    expect(getSettingsSnapshot({}).showDislikes).toBe(true)
  })

  it('defaults desktop sidebar autohide setting off in snapshots', () => {
    expect(getSettingsSnapshot({}).autoHideSidebar).toBe(false)
  })

  it('defaults pull to refresh setting on in snapshots', () => {
    expect(getSettingsSnapshot({}).pullToRefreshEnabled).toBe(true)
  })

  it('defaults text zoom to 100 in snapshots', () => {
    expect(getSettingsSnapshot({}).defaultZoom).toBe(100)
  })

  it('defaults double-tap translation off with no target language', () => {
    expect(getSettingsSnapshot({}).translateComments).toBe(false)
    expect(getSettingsSnapshot({}).translationTargetLanguage).toBeNull()
  })

  it('normalizes missing original video title setting to false', () => {
    const settings = normalizePartialSettings()
    expect(settings?.showOriginalVideoTitle).toBe(false)
  })

  it('normalizes missing show dislikes setting to true', () => {
    const settings = normalizePartialSettings()
    expect(settings?.showDislikes).toBe(true)
  })

  it('normalizes missing desktop sidebar autohide setting to false', () => {
    const settings = normalizePartialSettings()
    expect(settings?.autoHideSidebar).toBe(false)
  })

  it('normalizes missing pull to refresh setting to true', () => {
    const settings = normalizePartialSettings()
    expect(settings?.pullToRefreshEnabled).toBe(true)
  })

  it('normalizes missing text zoom to 100', () => {
    const settings = normalizePartialSettings()
    expect(settings?.defaultZoom).toBe(100)
  })

  it('normalizes invalid double-tap translation settings', () => {
    const settings = normalizeSettings<Partial<SettingsSnapshot>>({
      translateComments: undefined,
      translationTargetLanguage: '   ',
    })
    expect(settings?.translateComments).toBe(false)
    expect(settings?.translationTargetLanguage).toBeNull()
  })

  it('carries the old mini player corner over to a position', () => {
    const settings = normalizeSettings({ miniPlayerCorner: 'top-left' } as Partial<SettingsSnapshot>)
    expect(settings?.miniPlayerPosition).toEqual({ x: 0, y: 0 })
    expect(getSettingsSnapshot({}).miniPlayerPosition).toEqual({ x: 1, y: 1 })
  })

  it('clamps an out-of-range mini player position', () => {
    const settings = normalizeSettings<Partial<SettingsSnapshot>>({ miniPlayerPosition: { x: 2, y: -1 } })
    expect(settings?.miniPlayerPosition).toEqual({ x: 1, y: 0 })
  })
})

describe('YTPremium mobile defaults', () => {
  it('uses the owner-chosen defaults for a fresh install', () => {
    const s = getSettingsSnapshot({})
    expect(s.headerPosition).toBe('bottom')
    expect(s.autoHideHeader).toBe(true)
    expect(s.showLibraryButtonInHeader).toBe(false)
    expect(s.showStarButtonInHeader).toBe(false)
    expect(s.feedsEnabled).toBe(false)
    expect(s.hideShorts).toBe(false)
    expect(s.miniPlayer).toBe(true)
    expect(s.pictureInPicture).toBe(true)
    expect(s.showDislikes).toBe(true)
    expect(s.sponsorBlock).toBe(true)
    expect(s.blockAds).toBe(true)
  })

  it('keeps a value the user already chose', () => {
    const s = getSettingsSnapshot({ headerPosition: 'top', miniPlayer: false, hideShorts: true })
    expect(s.headerPosition).toBe('top')
    expect(s.miniPlayer).toBe(false)
    expect(s.hideShorts).toBe(true)
  })
})
