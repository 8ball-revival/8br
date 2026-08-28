'use client'

import { useEffect, useState } from 'react'

import { BACKGROUND_CHANGED, loadBackground } from '@/lib/display/background-store'
import { applyDisplay } from '@/lib/display/settings'
import { migrateOnce, useDisplaySettings } from '@/lib/display/store'

/**
 * The part of Display Lab that runs whether or not the panel is open.
 *
 * Renders nothing. It exists because three things have to happen on every page, once, and none of
 * them belongs to a control the reader may never click:
 *
 *   · the stored settings are re-applied after VALIDATION. The pre-paint script in <head> is a
 *     deliberately dumb interpreter — fast, unable to fail, and unable to check anything — so a
 *     value that is out of range or no longer offered reaches the document as an attribute no rule
 *     matches. That renders as the default, which is correct, but the document is then describing a
 *     setting that is not in effect. Re-applying the parsed settings makes the DOM tell the truth.
 *
 *   · an old `8br-hud` configuration is carried forward, once. A reader who had chosen the red
 *     accent, turned off scanlines and slowed the motion keeps all three.
 *
 *   · the custom background is fetched from IndexedDB and published as an object URL. That cannot
 *     happen before paint — IndexedDB is asynchronous — so it is the one setting that arrives a
 *     moment late. It fades in rather than appearing, and because the background is a fixed layer
 *     behind everything, its arrival moves nothing on the page.
 */
export function DisplayRuntime() {
  const [settings] = useDisplaySettings()

  useEffect(() => {
    migrateOnce()
    applyDisplay(document.documentElement, settings)
  }, [settings])

  /*
   * The URL is published whenever an image EXISTS, not when the setting asks for one.
   *
   * Tying it to `background === 'custom'` looked equivalent and was not: the live preview writes the
   * DRAFT to the document, so a reader who had just chosen a picture and switched to Full Page got
   * `data-dl-bg="custom"` with no URL behind it — an empty layer where the preview had promised the
   * real rendering. The stylesheet only reads `--dl-bg-url` under `[data-dl-bg='custom']`, so
   * publishing it unconditionally costs one object URL for an image the reader has already chosen,
   * and makes the preview and the page agree by construction.
   */
  const [imageVersion, setImageVersion] = useState(0)

  useEffect(() => {
    const bump = () => setImageVersion((n) => n + 1)
    window.addEventListener(BACKGROUND_CHANGED, bump)
    return () => window.removeEventListener(BACKGROUND_CHANGED, bump)
  }, [])

  useEffect(() => {
    let url: string | null = null
    let cancelled = false

    loadBackground().then((record) => {
      if (cancelled) return
      if (!record) { document.documentElement.style.removeProperty('--dl-bg-url'); return }
      url = URL.createObjectURL(record.blob)
      document.documentElement.style.setProperty('--dl-bg-url', `url("${url}")`)
    }).catch(() => { /* no stored image: the layer stays empty, and the scrim is harmless */ })

    /*
     * The object URL is revoked on the way out. It pins the Blob's memory for the lifetime of the
     * document otherwise, and a reader changing background a few times would hold every image they
     * had tried in memory at once — on a phone, that is the difference between a working tab and a
     * reloaded one.
     */
    return () => {
      cancelled = true
      if (url) URL.revokeObjectURL(url)
    }
  }, [imageVersion])

  return null
}
