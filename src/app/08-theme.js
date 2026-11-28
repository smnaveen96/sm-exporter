    // ---- Light and dark themes -----------------------------------------------------------------------------
    // The plugin follows Figma's own theme (figma.showUI's themeColors puts figma-light / figma-dark on <html>)
    // until the switch in the header picks one. Picking the theme Figma is already in goes back to following
    // it. The choice is remembered (code.js keeps it). The colours themselves are the tokens in the styles,
    // under :root and :root[data-theme="dark"].
    const themeToggle = document.getElementById('theme-toggle')
    let themeChoice = 'auto' // 'auto' | 'light' | 'dark'
    const darkQuery = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null

    function figmaTheme() {
      const html = document.documentElement
      if (html.classList.contains('figma-dark')) return 'dark'
      if (html.classList.contains('figma-light')) return 'light'
      return darkQuery && darkQuery.matches ? 'dark' : 'light' // outside Figma
    }
    function shownTheme() { return themeChoice === 'auto' ? figmaTheme() : themeChoice }
    // The switch cross-fades the whole window as one picture (a view transition), instead of fading every
    // element's colours on its own: that was hundreds of separate fades at once, which lagged, and the
    // gradients (which can't fade) changed straight away while flat colours were still on their way, so
    // grey patches showed mid-switch. Where view transitions aren't available, the theme just switches.
    let pendingTheme = '' // the theme a cross-fade is about to put in place
    function applyTheme(fade) {
      const root = document.documentElement
      const theme = shownTheme()
      if ((pendingTheme || root.dataset.theme) === theme) return
      pendingTheme = theme
      // Elements' own colour transitions (hover fades and the like) stay off while the theme swaps, so the new
      // theme lands in one go under the cross-fade; only the switch keeps its motion.
      root.classList.add('theme-switching')
      const settle = () => requestAnimationFrame(() => requestAnimationFrame(() => root.classList.remove('theme-switching')))
      const swap = () => {
        pendingTheme = ''
        root.dataset.theme = theme
        themeToggle.setAttribute('aria-checked', String(theme === 'dark'))
        themeToggle.title = theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'
      }
      const still = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches
      if (fade && !still && document.startViewTransition && document.visibilityState === 'visible') {
        try {
          document.startViewTransition(swap).finished.finally(settle)
          return
        } catch (error) { /* fall through */ }
      }
      swap()
      settle()
    }
    applyTheme(false)

    themeToggle.addEventListener('click', () => {
      const next = shownTheme() === 'dark' ? 'light' : 'dark'
      themeChoice = next === figmaTheme() ? 'auto' : next
      applyTheme(true)
      post({ type: 'theme-set', theme: themeChoice })
    })
    // Figma's theme changing while the plugin is open (only shows while following it). Other class changes on
    // <html> (theme-switching, above) are ignored: reacting to those started a second switch before the first
    // had landed, over and over.
    let lastFigmaTheme = figmaTheme()
    new MutationObserver(() => {
      const now = figmaTheme()
      if (now === lastFigmaTheme) return
      lastFigmaTheme = now
      applyTheme(true)
    }).observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    if (darkQuery && darkQuery.addEventListener) darkQuery.addEventListener('change', () => applyTheme(true))

    window.addEventListener('message', (event) => {
      const message = event.data && event.data.pluginMessage
      if (!message || message.type !== 'theme') return
      themeChoice = message.theme === 'light' || message.theme === 'dark' ? message.theme : 'auto'
      applyTheme(false)
    })
    post({ type: 'theme-get' })
