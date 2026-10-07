/*
 * YTPremium: oculta el botón "Abrir app" de la barra superior de m.youtube.com,
 * que invita a abrir la app oficial de YouTube.
 *
 * Se busca por el texto del botón (no por clases de YouTube, que cambian seguido)
 * y solo dentro de la barra superior, para no tocar nada más de la página.
 */
const OPEN_APP_TEXTS = new Set([
  'abrir app',
  'abrir la app',
  'abrir aplicación',
  'abrir la aplicación',
  'open app',
  'open the app',
  'abrir o app',
])

const TOPBAR_SELECTOR = 'ytm-mobile-topbar-renderer, .mobile-topbar-header, .mobile-topbar-header-content, header'
const BUTTON_SELECTOR = 'button, a, [role="button"]'
const HIDDEN_ATTR = 'data-ytpremium-hidden'

const normalize = (text: string | null) => (text || '').replace(/\s+/g, ' ').trim().toLowerCase()

function hideOpenAppButtons() {
  for (const topbar of document.querySelectorAll(TOPBAR_SELECTOR)) {
    for (const button of topbar.querySelectorAll<HTMLElement>(BUTTON_SELECTOR)) {
      if (button.closest(`[${HIDDEN_ATTR}]`)) continue
      const text = normalize(button.textContent) || normalize(button.getAttribute('aria-label'))
      if (!OPEN_APP_TEXTS.has(text)) continue
      const target = (button.closest('ytm-button-renderer, ytm-topbar-menu-button-renderer') as HTMLElement | null) ?? button
      target.style.setProperty('display', 'none', 'important')
      target.setAttribute(HIDDEN_ATTR, '')
    }
  }
}

export function installHideOpenAppButton() {
  if (!location.hostname.startsWith('m.youtube.')) return
  let scheduled = false
  const run = () => {
    scheduled = false
    try {
      hideOpenAppButtons()
    } catch (e) {
      console.error('YTPremium open-app: ', e)
    }
  }
  const schedule = () => {
    if (scheduled) return
    scheduled = true
    requestAnimationFrame(run)
  }
  const start = () => {
    run()
    new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true })
  }
  if (document.documentElement) {
    start()
  } else {
    document.addEventListener('DOMContentLoaded', start)
  }
}
