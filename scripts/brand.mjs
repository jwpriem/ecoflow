// Writes the WattsWise mark (a house with a charged battery under the sun) into every icon and logo SVG.
// Run with `node scripts/brand.mjs`, then render the PNGs from scripts/icon.svg and scripts/icon-maskable.svg
// (see README). The house and bolt are cut out of the sun and battery with masks, so the mark works on any background.
import { readFileSync, writeFileSync } from 'node:fs'

const NIGHT = { house: '#E9F0F1', battery: '#4DBFA9', sun: '#F2BA30' }
const DAY = { house: '#0F2229', battery: '#1B7062', sun: '#A87700' }
const BG = '#16262E'

const HOUSE = 'M70 294L226 158L382 294 M122 258V426H330V258'
// Bounding box of the mark, strokes included
const BOX = { x: 57, y: 61, w: 410, h: 378 }

function mark(c, id) {
  return `<defs>
    <mask id="${id}-sun" maskUnits="userSpaceOnUse" x="0" y="0" width="512" height="512"><rect width="512" height="512" fill="#fff"/><path d="${HOUSE}" fill="none" stroke="#000" stroke-width="66" stroke-linecap="round" stroke-linejoin="round"/></mask>
    <mask id="${id}-bolt" maskUnits="userSpaceOnUse" x="0" y="0" width="512" height="512"><rect width="512" height="512" fill="#fff"/><path d="M236 284L198 340H226L216 382L254 326H226Z" fill="#000" stroke="#000" stroke-width="6" stroke-linejoin="round"/></mask>
  </defs>
  <g stroke-linecap="round" stroke-linejoin="round">
    <g mask="url(#${id}-sun)">
      <path d="M358 72V92 M427 101L413 115 M456 170H436 M289 101L303 115 M427 239L413 225" stroke="${c.sun}" stroke-width="22"/>
      <circle cx="358" cy="170" r="50" fill="${c.sun}"/>
    </g>
    <path d="${HOUSE}" fill="none" stroke="${c.house}" stroke-width="26"/>
    <g fill="${c.battery}" mask="url(#${id}-bolt)">
      <rect x="208" y="254" width="36" height="24" rx="7"/>
      <rect x="176" y="268" width="100" height="130" rx="18"/>
    </g>
  </g>`
}

// Square app icon: the mark centred on the night background, scaled by `scale`
function icon(rx, scale) {
  const cx = BOX.x + BOX.w / 2, cy = BOX.y + BOX.h / 2
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <title>WattsWise</title>
  <rect width="512" height="512" rx="${rx}" fill="${BG}"/>
  <g transform="translate(256 256) scale(${scale}) translate(${-cx} ${-cy})">
  ${mark(NIGHT, 'ww')}
  </g>
</svg>
`
}

writeFileSync('scripts/icon.svg', icon(0, 1))
writeFileSync('scripts/icon-maskable.svg', icon(0, 0.8))
// iOS rounds the Home Screen icon's corners hard, so the apple-touch-icon gets extra room around the mark
writeFileSync('scripts/icon-apple.svg', icon(0, 0.78))
writeFileSync('public/favicon.svg', icon(112, 1))
writeFileSync('public/brand/wattswise-mark.svg', `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${BOX.x} ${BOX.y} ${BOX.w} ${BOX.h}">
  <title>WattsWise</title>
  ${mark(NIGHT, 'ww')}
</svg>
`)

// Logos: same height as the old W (85.85 units), the wordmark 30 units to its right
const H = 85.85, k = H / BOX.h, W = BOX.w * k, GAP = 30
for (const [file, c] of [['logo-light', DAY], ['logo-dark', NIGHT], ['lockup-light', DAY], ['lockup-dark', NIGHT]]) {
  const path = `public/brand/wattswise-${file}.svg`
  const src = readFileSync(path, 'utf8')
  const vb = src.match(/viewBox="-2 -2 ([\d.]+) ([\d.]+)"/)
  const top = file.startsWith('lockup') ? -6.55 : 0
  // Keep everything after the mark (wordmark, tagline) and slide it so it starts GAP after the new mark.
  // Measured from the file itself, so running the script again changes nothing
  const rest = src.slice(src.indexOf('<path transform="translate(')).replace(/<\/svg>\s*$/, '')
  const shift = Number(rest.match(/translate\(([\d.]+)/)[1]) - (W + GAP)
  const moved = rest.replace(/translate\(([\d.]+) ([\d.]+)\)/g, (_, x, y) => `translate(${(x - shift).toFixed(2)} ${y})`)
  const width = (vb[1] - shift).toFixed(1)
  const title = src.match(/<title>.*<\/title>/)[0]
  writeFileSync(path, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-2 -2 ${width} ${vb[2]}">
  ${title}
  <g transform="translate(0 ${top}) scale(${k.toFixed(5)}) translate(${-BOX.x} ${-BOX.y})">
  ${mark(c, 'ww')}
  </g>
  ${moved.trim()}
</svg>
`)
}
