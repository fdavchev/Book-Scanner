import { useEffect, useState } from 'react'

function isIosSafari(): boolean {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent
  const iOS = /iPad|iPhone|iPod/.test(ua) || (ua.includes('Macintosh') && navigator.maxTouchPoints > 1)
  // Chrome and Firefox on iOS are Safari underneath but cannot install a web app, and
  // both put their own token in the user agent.
  return iOS && !/CriOS|FxiOS|EdgiOS/.test(ua)
}

function isStandalone(): boolean {
  if (typeof window === 'undefined') return false
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as { standalone?: boolean }).standalone === true
  )
}

const DISMISSED_KEY = 'book-scanner:install-hint-dismissed'

/**
 * iOS shows no install prompt at all, so the app has to say the words itself. Android
 * Chrome fires `beforeinstallprompt`, which is turned into a real button.
 */
export function InstallHint() {
  const [prompt, setPrompt] = useState<Event & { prompt?: () => Promise<void> }>()
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(DISMISSED_KEY) === '1'
    } catch {
      // A browser with storage blocked simply gets the hint every time.
      return false
    }
  })

  useEffect(() => {
    const onPrompt = (event: Event) => {
      event.preventDefault()
      setPrompt(event as Event & { prompt?: () => Promise<void> })
    }
    window.addEventListener('beforeinstallprompt', onPrompt)
    return () => window.removeEventListener('beforeinstallprompt', onPrompt)
  }, [])

  function dismiss() {
    setDismissed(true)
    try {
      localStorage.setItem(DISMISSED_KEY, '1')
    } catch {
      // A browser with storage blocked simply gets the hint again next time.
    }
  }

  if (dismissed || isStandalone()) return null

  if (prompt) {
    return (
      <div className="banner" style={{ margin: '0 16px 84px' }}>
        <p className="small" style={{ marginBottom: 8 }}>
          Install Book Scanner to your home screen so it opens like an app and works
          offline.
        </p>
        <div className="row">
          <button
            type="button"
            className="primary"
            onClick={() => {
              void prompt.prompt?.()
              dismiss()
            }}
          >
            Install app
          </button>
          <button type="button" onClick={dismiss}>
            Not now
          </button>
        </div>
      </div>
    )
  }

  if (!isIosSafari()) return null

  return (
    <div className="banner" style={{ margin: '0 16px 84px' }}>
      <p className="small" style={{ marginBottom: 8 }}>
        To keep this app on your iPhone: tap the <strong>Share</strong> button at the
        bottom of Safari, scroll down, and choose <strong>Add to Home Screen</strong>.
      </p>
      <button type="button" onClick={dismiss}>
        Got it
      </button>
    </div>
  )
}
