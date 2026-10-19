// Ambient types for stylesheets imported as text (build.mjs loader .css: text). Not css.d.ts: next to css.ts, tsc would read that name as css.ts's own declaration output and skip it.
declare module '*.css' {
  const text: string
  export default text
}

// Fonts imported as data URIs (build.mjs loader .woff2: dataurl).
declare module '*.woff2' {
  const uri: string
  export default uri
}
