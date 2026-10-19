// Stylesheets travel inside the bundle as text (esbuild loader .css: text) and are put into the document once.
// Desktop loads one plain-ESM file and the browser page one script, so neither can link a stylesheet of its own.
const done = new Set<string>()

export function injectCss(id: string, text: string): void {
  if (typeof document === 'undefined' || done.has(id)) return
  const el = document.createElement('style')
  el.dataset.crew = id
  el.textContent = text
  document.head.appendChild(el)
  done.add(id)
}
