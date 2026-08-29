import { useCallback, useEffect, useState } from 'react'
import { DEFAULT_SETTINGS, getSettings, saveSettings, type Settings } from '../storage/db'
import { probeConnectivity } from '../pipeline/enrich'
import { isOfflineReady } from '../offline/ocrAssets'

export interface SettingsApi {
  settings: Settings
  update: (changes: Partial<Settings>) => Promise<void>
  /** Result of a real reachability probe, not just `navigator.onLine`. */
  online: boolean
  recheckConnectivity: () => Promise<void>
  offlineReady: boolean
  recheckOffline: () => Promise<void>
}

export function useSettings(): SettingsApi {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS)
  const [online, setOnline] = useState(true)
  const [offlineReady, setOfflineReady] = useState(false)

  const recheckConnectivity = useCallback(async () => {
    setOnline(await probeConnectivity())
  }, [])

  const recheckOffline = useCallback(async () => {
    const current = await getSettings()
    setOfflineReady(await isOfflineReady(current.languages))
  }, [])

  useEffect(() => {
    void (async () => {
      setSettings(await getSettings())
      await recheckConnectivity()
      await recheckOffline()
    })()

    // The browser's own events are a cheap trigger for a re-probe; the probe, not the
    // event, is what the pill actually reports.
    const onChange = () => void recheckConnectivity()
    window.addEventListener('online', onChange)
    window.addEventListener('offline', onChange)
    return () => {
      window.removeEventListener('online', onChange)
      window.removeEventListener('offline', onChange)
    }
  }, [recheckConnectivity, recheckOffline])

  const update = useCallback(
    async (changes: Partial<Settings>) => {
      setSettings(await saveSettings(changes))
      if (changes.languages) await recheckOffline()
    },
    [recheckOffline],
  )

  return { settings, update, online, recheckConnectivity, offlineReady, recheckOffline }
}
