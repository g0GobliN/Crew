import archivo from '../../assets/fonts/archivo-900-subset.woff2'
import mono from '../../assets/fonts/jetbrains-mono-500-subset.woff2'

// The splash's two brand faces as data URIs (build.mjs loader .woff2: dataurl), under names of their own so they never
// collide with a font the app or the board uses. Glyph subsets: only what Splash.tsx prints (fonts/LICENSE.md).
export const ARCHIVO_URI: string = archivo
export const MONO_URI: string = mono
export const FONT_FACE_CSS =
  `@font-face{font-family:CrewArchivo;font-weight:900;font-style:normal;font-display:block;src:url(${archivo}) format('woff2')}` +
  `@font-face{font-family:CrewMono;font-weight:500;font-style:normal;font-display:block;src:url(${mono}) format('woff2')}`
