// Builds the two shipped bundles from ui/src and, with --check, proves the committed files are current.
//   node ui/build.mjs            write desktop/plugin.js and scripts/crew_dashboard/app.js
//   node ui/build.mjs --check    build into a temp dir, byte-compare with the committed files, exit 1 if stale
// desktop/plugin.js is read by Hermes Desktop as-is (runtime-loader.ts:72-79: only @hermes/plugin-sdk, react and
// react/jsx-runtime may be imported; :694: 512 KiB cap) and must stay readable (catalog rule 8): no minify.
import { build } from 'esbuild'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const UI = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.dirname(UI)
const ALLOWED = ['@hermes/plugin-sdk', 'react', 'react/jsx-runtime']
const MAX_DESKTOP = 512 * 1024
const check = process.argv.includes('--check')

// Stylesheets ship verbatim inside the bundles, so their bytes must not depend on how git checked them out:
// a CRLF working copy (Windows runners) must build the same file as an LF one. .gitattributes pins LF too;
// this is the belt to that suspender.
const lfText = {
  name: 'lf-text',
  setup(b) {
    b.onLoad({ filter: /\.css$/ }, async args => ({
      contents: (await fs.promises.readFile(args.path, 'utf8')).replace(/\r\n?/g, '\n'),
      loader: 'text'
    }))
  }
}

// The plugin version, from plugin.yaml (the same regex dev/publish.py uses), embedded as __CREW_VERSION__ in both bundles.
const version = fs.readFileSync(path.join(ROOT, 'plugin.yaml'), 'utf8').match(/^version:\s*(\S+)/m)[1]

const banner = src => ({
  js: `// GENERATED from ${src} by ui/build.mjs. Do not edit by hand: change the source and run \`node ui/build.mjs\`.`
})
const targets = [
  { rel: 'desktop/plugin.js', src: 'ui/src/desktop.tsx', format: 'esm', external: ALLOWED },
  { rel: 'scripts/crew_dashboard/app.js', src: 'ui/src/browser.tsx', format: 'iife', external: [] }
]

const outDir = check ? fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'crew-ui-check-')) : ROOT
const problems = []
try {
  for (const t of targets) {
    const outfile = path.join(outDir, t.rel)
    await build({
      entryPoints: [path.join(ROOT, t.src)],
      outfile,
      bundle: true,
      format: t.format,
      external: t.external,
      loader: { '.css': 'text', '.woff2': 'dataurl' },
      plugins: [lfText],   // stylesheets ship inside the bundle: Desktop loads one file and the browser page one script
      jsx: 'automatic',
      jsxImportSource: 'react',
      minify: false,
      target: 'es2022',
      banner: banner(t.src),
      legalComments: 'none',
      logLevel: 'warning',
      define: { 'process.env.NODE_ENV': '"production"', __CREW_VERSION__: JSON.stringify(version) },
      absWorkingDir: UI,
      // the publish gate symlinks ui/node_modules into the exported tree: without this esbuild writes the symlink's
      // real path into the module comments and the same source builds different bytes in two places
      preserveSymlinks: true
    })
    const text = fs.readFileSync(outfile, 'utf8')
    const bytes = Buffer.byteLength(text)
    if (t.rel === 'desktop/plugin.js') {
      if (bytes >= MAX_DESKTOP) problems.push(`${t.rel} is ${bytes} bytes, Desktop's cap is ${MAX_DESKTOP}`)
      const specs = [...text.matchAll(/^import .* from ['"]([^'"]+)['"]/gm)].map(m => m[1])
      const bad = specs.filter(s => !ALLOWED.includes(s))
      if (bad.length) problems.push(`${t.rel} imports ${[...new Set(bad)].join(', ')}; only ${ALLOWED.join(', ')} are allowed`)
      if (/^\s*import\b(?!.* from )/m.test(text) || /\bimport\(/.test(text)) problems.push(`${t.rel} has a bare or dynamic import`)
    }
    console.log(`${t.rel}  ${bytes} bytes`)
    if (check) {
      const committed = path.join(ROOT, t.rel)
      if (!fs.existsSync(committed) || !fs.readFileSync(committed).equals(fs.readFileSync(outfile)))
        problems.push(`${t.rel} is stale: it does not match ui/src. Run \`node ui/build.mjs\` and commit the result.`)
    }
  }
} finally {
  if (check) fs.rmSync(outDir, { recursive: true, force: true })
}
if (problems.length) {
  for (const p of problems) console.error('FAILED: ' + p)
  process.exit(1)
}
