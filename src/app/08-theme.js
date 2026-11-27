    // ---- Light and dark themes -----------------------------------------------------------------------------
    // The plugin follows Figma's own theme (figma.showUI's themeColors puts figma-light / figma-dark on <html>)
    // until the switch in the header picks one. Picking the theme Figma is already in goes back to following
    // it. The choice is remembered (code.js keeps it). The colours themselves are the tokens in the styles,
    // under :root and :root[data-theme="dark"].
    const themeToggle = document.getElementById('theme-toggle')
    let themeChoice = 'auto' // 'auto' | 'light' | 'dark'
    let themeFadeTimer = 0
    const darkQuery = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null

    function figmaTheme() {
      const html = document.documentElement
      if (html.classList.contains('figma-dark')) return 'dark'
      if (html.classList.contains('figma-light')) return 'light'
      return darkQuery && darkQuery.matches ? 'dark' : 'light' // outside Figma
    }
    function shownTheme() { return themeChoice === 'auto' ? figmaTheme() : themeChoice }
    function applyTheme(fade) {
      const root = document.documentElement
      const theme = shownTheme()
      if (root.dataset.theme === theme) return
      if (fade) {
        root.classList.add('theme-fading')
        clearTimeout(themeFadeTimer)
        themeFadeTimer = setTimeout(() => root.classList.remove('theme-fading'), 300)
      }
      root.dataset.theme = theme
      themeToggle.setAttribute('aria-checked', String(theme === 'dark'))
      themeToggle.title = theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'
    }
    applyTheme(false)

    themeToggle.addEventListener('click', () => {
      const next = shownTheme() === 'dark' ? 'light' : 'dark'
      themeChoice = next === figmaTheme() ? 'auto' : next
      applyTheme(true)
      post({ type: 'theme-set', theme: themeChoice })
    })
    // Figma's theme changing while the plugin is open (only shows while following it).
    new MutationObserver(() => applyTheme(true)).observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    if (darkQuery && darkQuery.addEventListener) darkQuery.addEventListener('change', () => applyTheme(true))

    window.addEventListener('message', (event) => {
      const message = event.data && event.data.pluginMessage
      if (!message || message.type !== 'theme') return
      themeChoice = message.theme === 'light' || message.theme === 'dark' ? message.theme : 'auto'
      applyTheme(false)
    })
    post({ type: 'theme-get' })
