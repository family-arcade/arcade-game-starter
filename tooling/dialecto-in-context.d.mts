// Types for dialecto-in-context.mjs (copied unchanged from the Dialecto SDK), so vite.config.ts type-checks.
import type { PluginOption } from 'vite'

export function dialectoInContextVite(options?: {
  url?: string
  project?: string
  catalogs?: string
  sourceLocale?: string
  enabled?: boolean
  /** The shortcut that shows or hides the editor, e.g. 'alt+shift+d' (the default). Alt is required. */
  toggleKey?: string
  /** Open the page with the editor hidden until the shortcut. */
  hidden?: boolean
  /** Where the Edit text button sits. */
  corner?: 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left'
  saveToFiles?: boolean
  [option: string]: unknown
}): PluginOption
