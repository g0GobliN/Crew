// The Desktop host provides this module at runtime (apps/desktop/src/sdk/index.ts); only what Crew uses is typed.
declare module '@hermes/plugin-sdk' {
  import type { ComponentType } from 'react'
  export const ROUTES_AREA: string
  export const SIDEBAR_NAV_AREA: string
  export const PANES_AREA: string
  export interface DesktopThemeColors {
    background: string; foreground: string; card: string; cardForeground: string; muted: string
    mutedForeground: string; primary: string; primaryForeground: string; accent: string
    accentForeground: string; border: string; destructive: string; sidebarBackground?: string
  }
  export interface DesktopTheme {
    colors: DesktopThemeColors
    darkColors?: DesktopThemeColors
    typography?: { fontSans?: string; fontMono?: string }
  }
  // Optional in older shells (the app's own message renderer, markdown, Button, ConfirmDialog): feature-detected.
  export const MessageTextContent: ComponentType<{ text: string; media?: boolean }> | undefined
  export const SIDEBAR_NAV_PREFS_AREA: string | undefined   // the sidebarNav.prefs area (store/sidebar-nav.ts)
  export const Streamdown: ComponentType<{ children?: string }> | undefined
  export const Button: ComponentType<Record<string, unknown>> | undefined
  export const ConfirmDialog: ComponentType<Record<string, unknown>> | undefined
  // Optional in older shells: the host verbs (toast, router). A toast with an action button is how Crew offers "Open in Crew".
  export const host: {
    notify?(n: { id?: string; kind?: string; title?: string; message: string; detail?: string; action?: { label: string; onClick: () => void } }): string
    navigate?(path: string): void
    /** Open a stored chat session (Desktop's plugin-session contract, apps/desktop/src/sdk PluginOpenSessionOptions). */
    openSession?(sessionId: string, opts?: { profile?: string; intent?: string }): Promise<unknown>
  } | undefined
  export function useTheme(): { theme: DesktopTheme; renderedMode: 'light' | 'dark' }
}
