import type { CSSProperties } from 'react'
import type { DesktopTheme } from '@hermes/plugin-sdk'

// Desktop theme -> the inputs base.css expects. Nothing here is a literal colour: every value is a theme field, the
// app's own --ui-success, or a colour-mix of those. Everything else in the --crew-* ladder is derived in base.css.
//
//   --crew-bg / --crew-fg        colors.background / colors.foreground
//   color-scheme                 renderedMode (the mode actually painted, not the user's switch)
//   --crew-font / --crew-mono    typography.fontSans / typography.fontMono
//   --crew-in-blocked            colors.destructive
//   --crew-in-ready              colors.primary
//   --crew-in-running            the app's --ui-success (its success green, bent toward the accent), else colors.primary
//   --crew-in-done               running mixed into ready
//   --crew-in-review             blocked mixed into running (the amber between red and green)
//
// useTheme().theme.colors is already the palette of the painted mode; darkColors is only read for a raw skin object.
export function crewVarsFromTheme(theme: DesktopTheme, mode: 'light' | 'dark' = 'light'): CSSProperties {
  const c = mode === 'dark' && theme.darkColors ? theme.darkColors : theme.colors
  return {
    '--crew-bg': c.background,
    '--crew-fg': c.foreground,
    '--crew-font': theme.typography?.fontSans ?? 'system-ui, sans-serif',
    '--crew-mono': theme.typography?.fontMono ?? 'ui-monospace, monospace',
    '--crew-in-blocked': c.destructive,
    '--crew-in-ready': c.primary,
    '--crew-in-running': `var(--ui-success, ${c.primary})`,
    '--crew-in-done': 'color-mix(in srgb, var(--crew-in-running) 55%, var(--crew-in-ready))',
    '--crew-in-review': 'color-mix(in srgb, var(--crew-in-blocked) 45%, var(--crew-in-running))',
    colorScheme: mode
  } as CSSProperties
}
