// utils/animate.js — turns a finished static quote into a Telegram video sticker:
// the source video plays under the static bubble, which has a rounded hole punched
// where the media thumbnail was. Output: VP9+alpha webm, ≤3s, ≤256KB, no audio.
const sharp = require('sharp')
const { execFile } = require('child_process')
const { promisify } = require('util')
const crypto = require('crypto')
const fs = require('fs')
const os = require('os')
const path = require('path')

const MAX_BYTES = 256 * 1024
const CRF_LADDER = [32, 38, 44, 50]

// Rounded-rect path with per-corner radii, in output px.
function roundedRect ({ x, y, w, h, radii: r }) {
  return `M${x + r.tl},${y} H${x + w - r.tr} A${r.tr},${r.tr} 0 0 1 ${x + w},${y + r.tr} V${y + h - r.br} ` +
    `A${r.br},${r.br} 0 0 1 ${x + w - r.br},${y + h} H${x + r.bl} A${r.bl},${r.bl} 0 0 1 ${x},${y + h - r.bl} ` +
    `V${y + r.tl} A${r.tl},${r.tl} 0 0 1 ${x + r.tl},${y} Z`
}

// Playable length of the video's first stream in seconds (null if unknown). The still inputs
// loop forever, so the graph can't tell where the video ends: the output is capped to this instead.
async function videoSeconds (file) {
  try {
    const { stdout } = await promisify(execFile)('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=duration:format=duration', '-of', 'json', file], { timeout: 10000 })
    const j = JSON.parse(stdout)
    const d = Number(j.streams?.[0]?.duration ?? j.format?.duration)
    return d > 0 ? d : null
  } catch (_) {
    return null
  }
}

// staticImage: final sticker image buffer; rect: media rect in its pixels; video: source buffer.
async function animateQuote (staticImage, rect, video) {
  // yuv420 needs even dimensions: trim an odd last row/column so every layer agrees.
  const meta = await sharp(staticImage).metadata()
  const W = meta.width & ~1
  const H = meta.height & ~1
  staticImage = await sharp(staticImage).extract({ left: 0, top: 0, width: W, height: H }).toBuffer()
  const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><path d="${roundedRect(rect)}"/></svg>`)
  const overlay = await sharp(staticImage).ensureAlpha().composite([{ input: svg, blend: 'dest-out' }]).png().toBuffer()

  // Video may only show inside the bubble: its silhouette is the static image's alpha.
  const mask = await sharp(staticImage).ensureAlpha().extractChannel('alpha').threshold(128).png().toBuffer()

  const id = crypto.randomBytes(8).toString('hex')
  const [vf, of, mf, out] = ['v', 'o.png', 'm.png', 'out.webm'].map((n) => path.join(os.tmpdir(), `quote-anim-${id}-${n}`))
  const w = Math.round(rect.w); const h = Math.round(rect.h)
  const graph = `[0:v]setpts=PTS-STARTPTS,fps=24,scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},format=yuva420p[v];` +
    `color=c=black@0:s=${W}x${H}:r=24,format=yuva420p[bg];` +
    `[bg][v]overlay=${Math.round(rect.x)}:${Math.round(rect.y)}:eof_action=endall:format=auto[a];` +
    `[2:v]format=gray[m];[a]format=yuva420p[a2];[a2][m]alphamerge[c];[c][1:v]overlay=0:0:shortest=1:format=auto,scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuva420p`
  try {
    await Promise.all([fs.promises.writeFile(vf, video), fs.promises.writeFile(of, overlay), fs.promises.writeFile(mf, mask)])
    // Exactly the video's length (≤3s) so the sticker loops with no frozen tail.
    const seconds = Math.min(3, (await videoSeconds(vf)) ?? 3)
    for (const crf of CRF_LADDER) {
      await promisify(execFile)('ffmpeg', [
        '-y', '-i', vf, '-loop', '1', '-framerate', '24', '-i', of, '-loop', '1', '-framerate', '24', '-i', mf, '-filter_complex', graph,
        '-t', seconds.toFixed(3), '-an', '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p', '-b:v', '0', '-crf', String(crf),
        '-auto-alt-ref', '0', '-row-mt', '1', '-deadline', 'good', '-cpu-used', '4', out
      ], { timeout: 60000 })
      const buf = await fs.promises.readFile(out)
      if (buf.length <= MAX_BYTES) return buf
    }
    throw new Error('animated quote exceeds 256KB')
  } finally {
    for (const f of [vf, of, mf, out]) fs.unlink(f, () => {})
  }
}

module.exports = { animateQuote }
