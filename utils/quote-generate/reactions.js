// utils/quote-generate/reactions.js — the reaction pills row under a bubble's content:
// "❤ 3" per reaction (custom emoji supported), tinted with the sender's accent color.
const { createCanvas } = require('canvas')
const { drawRoundRect } = require('./canvas-utils')
const { drawMultilineText } = require('./text-renderer')

// reactions: [{ emoji | custom_emoji_id, count }]. Returns a canvas, or null when empty.
// ponytail: one row, pills that don't fit maxWidth are dropped; wrap to more rows if that bites.
async function drawReactions (reactions, { size, color, accent, maxWidth, emojiBrand, telegram }) {
  const padX = size * 0.55
  const padY = size * 0.3
  const gap = size * 0.4
  const pills = []
  let rowW = 0
  for (const r of reactions.slice(0, 8)) {
    const glyph = r.custom_emoji_id ? '🤡' : r.emoji // placeholder under a custom_emoji entity
    const label = r.count > 1 ? `${glyph} ${r.count}` : glyph
    const entities = r.custom_emoji_id ? [{ type: 'custom_emoji', offset: 0, length: 2, custom_emoji_id: r.custom_emoji_id }] : []
    const text = await drawMultilineText(label, entities, size, color, 0, size, maxWidth, size * 2, emojiBrand, telegram).catch(() => null)
    if (!text || text.width <= 1) continue
    const w = Math.ceil(text.width + 2 * padX)
    if (rowW + w > maxWidth) break
    pills.push({ text, w, x: rowW })
    rowW += w + gap
  }
  if (!pills.length) return null
  const h = Math.ceil(Math.max(...pills.map((p) => p.text.height)) + 2 * padY)
  const canvas = createCanvas(Math.ceil(rowW - gap), h)
  const ctx = canvas.getContext('2d')
  for (const p of pills) {
    ctx.globalAlpha = 0.22
    ctx.drawImage(drawRoundRect(accent, p.w, h, h / 2), p.x, 0)
    ctx.globalAlpha = 1
    ctx.drawImage(p.text, p.x + padX, (h - p.text.height) / 2)
  }
  return canvas
}

module.exports = { drawReactions }
