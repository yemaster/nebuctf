import { readFile, readdir, stat } from 'node:fs/promises'
import { resolve, join } from 'node:path'

const root = resolve('.vitepress/dist')
const base = process.env.DOCS_BASE || '/nebuctf/'
const origin = 'https://docs.invalid'
const files = []
async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = join(directory, entry.name)
    if (entry.isDirectory()) await walk(file)
    else if (entry.name.endsWith('.html')) files.push(file)
  }
}
await walk(root)
const pages = new Map(await Promise.all(files.map(async (file) => [file, await readFile(file, 'utf8')])))
const decode = (value) => value.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
const errors = new Set()
let checked = 0
for (const [file, html] of pages) {
  const pageUrl = new URL(base + file.slice(root.length + 1), origin)
  for (const match of html.matchAll(/\b(?:href|src)="([^"]+)"/g)) {
    const target = new URL(decode(match[1]), pageUrl)
    if (target.origin !== origin) continue
    const label = `${file.slice(root.length + 1)} → ${match[1]}`
    if (!target.pathname.startsWith(base)) {
      errors.add(`${label}: outside base ${base}`)
      continue
    }
    let path = resolve(root, decodeURIComponent(target.pathname.slice(base.length)) || 'index.html')
    if (!path.startsWith(root + '/')) {
      errors.add(`${label}: outside output directory`)
      continue
    }
    try {
      if ((await stat(path)).isDirectory()) path = join(path, 'index.html')
      await stat(path)
    } catch {
      errors.add(`${label}: missing file`)
      continue
    }
    if (target.hash && pages.has(path)) {
      const id = decodeURIComponent(target.hash.slice(1))
      const ids = new Set(Array.from(pages.get(path).matchAll(/\bid="([^"]+)"/g), (item) => decode(item[1])))
      if (!ids.has(id)) errors.add(`${label}: missing anchor ${id}`)
    }
    checked++
  }
}
if (errors.size) {
  console.error(Array.from(errors).join('\n'))
  process.exitCode = 1
} else {
  console.log(`Checked ${pages.size} pages and ${checked} internal links.`)
}
