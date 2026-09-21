/**
 * The diagram as a real SVG: rectangles, paths and text.
 *
 * Nothing is captured from the screen. The exporter draws from the same model
 * and the same measurements the canvas uses, so the file is genuine vector
 * artwork — it opens in a design tool, scales without blurring, and has no
 * `foreignObject` full of HTML in it.
 *
 * Positions come in the way the canvas holds them: a member of a group is
 * placed relative to its group.
 */
import type { Diagram, DiagramNode } from '../dsl'
import { EDGE_OPERATORS } from '../dsl'
import {
  HEADER_HEIGHT,
  ROW_HEIGHT,
  groupBox,
  measure,
  type Box,
  type Size
} from '../geometry'
import type { Point } from '../types'

/** The app's palette, so an export looks like what it was exported from. */
const COLOR = {
  background: '#0b0d12',
  surface: '#11141c',
  header: '#171b26',
  border: '#2a3140',
  groupBorder: '#3a4356',
  line: '#3d465a',
  name: '#e6eaf2',
  field: '#b9c1d0',
  muted: '#7b8598',
  accent: '#7ba3ff'
} as const

const SANS = "'Inter','Segoe UI',system-ui,sans-serif"
const MONO = "'JetBrains Mono','Cascadia Mono',Consolas,monospace"
const PADDING = 28
const RADIUS = 6

export interface SvgOptions {
  /** Drawn behind everything. Pass null for a transparent background. */
  background?: string | null
}

export function toSvg(
  diagram: Diagram,
  positions: Record<string, Point>,
  title: string,
  options: SvgOptions = {}
): string {
  const boxes = layoutBoxes(diagram, positions)
  if (boxes.size === 0) return empty(title, options)

  const all = [...boxes.values()]
  const minX = Math.min(...all.map((b) => b.x)) - PADDING
  const minY = Math.min(...all.map((b) => b.y)) - PADDING
  const width = Math.max(...all.map((b) => b.x + b.width)) + PADDING - minX
  const height = Math.max(...all.map((b) => b.y + b.height)) + PADDING - minY

  const vertical = diagram.type === 'flow'
  const groups = diagram.nodes.filter((n) => n.kind === 'group')
  const rest = diagram.nodes.filter((n) => n.kind !== 'group')

  const body = [
    ...groups.map((node) => group(node, boxes.get(node.id) as Box)),
    ...diagram.edges.map((edge) => {
      const from = boxes.get(edge.from.node)
      const to = boxes.get(edge.to.node)
      return from && to ? connector(from, to, edge, vertical) : ''
    }),
    ...rest.map((node) => shape(node, boxes.get(node.id) as Box))
  ]

  const background =
    options.background === null
      ? ''
      : `<rect x="${minX}" y="${minY}" width="${width}" height="${height}" fill="${
          options.background ?? COLOR.background
        }"/>`

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${round(width)}" height="${round(height)}" ` +
      `viewBox="${round(minX)} ${round(minY)} ${round(width)} ${round(height)}">`,
    `<title>${escape(title)}</title>`,
    defs(),
    background,
    ...body.filter(Boolean),
    '</svg>',
    ''
  ].join('\n')
}

// --------------------------------------------------------------------- pieces

function defs(): string {
  const arrow = (id: string, path: string): string =>
    `<marker id="${id}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" ` +
    `orient="auto-start-reverse"><path d="${path}" fill="${COLOR.line}"/></marker>`
  return `<defs>${arrow('arrow', 'M 0 1 L 10 5 L 0 9 z')}</defs>`
}

function group(node: DiagramNode, box: Box): string {
  return [
    `<g>`,
    rect(box, { fill: 'none', stroke: COLOR.groupBorder, dash: '4 4', radius: 10 }),
    text(box.x + 12, box.y + 20, node.name.toUpperCase(), {
      font: SANS,
      size: 10,
      fill: COLOR.muted,
      spacing: 0.8
    }),
    `</g>`
  ].join('')
}

function shape(node: DiagramNode, box: Box): string {
  // A table with no columns yet is still a table: a header with nothing under it.
  if (node.kind === 'table') return table(node, box)

  // A plain box: one centred name.
  return [
    `<g>`,
    rect(box, {
      fill: COLOR.surface,
      stroke: COLOR.border,
      dash: node.implicit ? '4 3' : undefined
    }),
    text(box.x + box.width / 2, box.y + box.height / 2 + 4, node.name, {
      font: SANS,
      size: 12,
      fill: node.implicit ? COLOR.field : COLOR.name,
      anchor: 'middle'
    }),
    `</g>`
  ].join('')
}

function table(node: DiagramNode, box: Box): string {
  const rows = node.fields.map((field, i) => {
    const y = box.y + HEADER_HEIGHT + i * ROW_HEIGHT + 14
    const type = field.type ?? ''
    const modifiers = field.modifiers.join(' ')
    const detail =
      `<text x="${round(box.x + box.width - 10)}" y="${round(y)}" text-anchor="end" ` +
      `font-family="${MONO}" font-size="11" fill="${COLOR.muted}">` +
      `${escape(type)}` +
      (modifiers ? `<tspan fill="${COLOR.accent}"> ${escape(modifiers)}</tspan>` : '') +
      `</text>`
    return (
      text(box.x + 10, y, field.name, { font: MONO, size: 11, fill: COLOR.field }) + detail
    )
  })

  return [
    `<g>`,
    rect(box, { fill: COLOR.surface, stroke: COLOR.border }),
    // The header is a band across the top, clipped to the rounded corners.
    `<path d="${topBand(box)}" fill="${COLOR.header}"/>`,
    `<line x1="${round(box.x)}" y1="${round(box.y + HEADER_HEIGHT)}" x2="${round(
      box.x + box.width
    )}" y2="${round(box.y + HEADER_HEIGHT)}" stroke="${COLOR.border}"/>`,
    text(box.x + 10, box.y + 20, node.name, {
      font: SANS,
      size: 12,
      fill: COLOR.name,
      weight: 500
    }),
    ...rows,
    `</g>`
  ].join('')
}

/** An edge, routed with one bend like the canvas does. */
function connector(
  from: Box,
  to: Box,
  edge: Diagram['edges'][number],
  vertical: boolean
): string {
  const [start, end] = anchors(from, to, vertical)
  const mid = vertical ? (start.y + end.y) / 2 : (start.x + end.x) / 2
  const path = vertical
    ? `M ${round(start.x)} ${round(start.y)} V ${round(mid)} H ${round(end.x)} V ${round(end.y)}`
    : `M ${round(start.x)} ${round(start.y)} H ${round(mid)} V ${round(end.y)} H ${round(end.x)}`

  const arrows = EDGE_OPERATORS[edge.kind]
  const markers =
    (arrows.includes('<') ? ' marker-start="url(#arrow)"' : '') +
    (arrows.includes('>') ? ' marker-end="url(#arrow)"' : '')

  const caption = edge.label ?? (edge.from.field ? `${edge.from.field} → ${edge.to.field ?? ''}` : '')
  const label = caption ? edgeLabel(caption, (start.x + end.x) / 2, (start.y + end.y) / 2) : ''

  return (
    `<path d="${path}" fill="none" stroke="${COLOR.line}" stroke-width="1.5"${markers}/>` + label
  )
}

function edgeLabel(caption: string, x: number, y: number): string {
  const width = caption.length * 5.6 + 8
  return (
    `<rect x="${round(x - width / 2)}" y="${round(y - 9)}" width="${round(width)}" height="14" ` +
    `rx="3" fill="${COLOR.background}"/>` +
    text(x, y + 1, caption, { font: SANS, size: 10, fill: COLOR.muted, anchor: 'middle' })
  )
}

/** Leave each box on the side that faces the other one. */
function anchors(from: Box, to: Box, vertical: boolean): [Point, Point] {
  if (vertical) {
    const downwards = to.y + to.height / 2 >= from.y + from.height / 2
    return [
      { x: from.x + from.width / 2, y: downwards ? from.y + from.height : from.y },
      { x: to.x + to.width / 2, y: downwards ? to.y : to.y + to.height }
    ]
  }
  const rightwards = to.x + to.width / 2 >= from.x + from.width / 2
  return [
    { x: rightwards ? from.x + from.width : from.x, y: from.y + from.height / 2 },
    { x: rightwards ? to.x : to.x + to.width, y: to.y + to.height / 2 }
  ]
}

// ---------------------------------------------------------------- primitives

function rect(
  box: Box,
  style: { fill: string; stroke: string; dash?: string; radius?: number }
): string {
  return (
    `<rect x="${round(box.x)}" y="${round(box.y)}" width="${round(box.width)}" ` +
    `height="${round(box.height)}" rx="${style.radius ?? RADIUS}" fill="${style.fill}" ` +
    `stroke="${style.stroke}"${style.dash ? ` stroke-dasharray="${style.dash}"` : ''}/>`
  )
}

/** The rounded top strip of a box, for a table's header band. */
function topBand(box: Box): string {
  const { x, y, width } = box
  const r = RADIUS
  return (
    `M ${round(x)} ${round(y + HEADER_HEIGHT)} V ${round(y + r)} ` +
    `Q ${round(x)} ${round(y)} ${round(x + r)} ${round(y)} ` +
    `H ${round(x + width - r)} Q ${round(x + width)} ${round(y)} ${round(x + width)} ${round(y + r)} ` +
    `V ${round(y + HEADER_HEIGHT)} Z`
  )
}

function text(
  x: number,
  y: number,
  value: string,
  style: {
    font: string
    size: number
    fill: string
    anchor?: string
    weight?: number
    spacing?: number
  }
): string {
  return (
    `<text x="${round(x)}" y="${round(y)}" font-family="${style.font}" font-size="${style.size}" ` +
    `fill="${style.fill}"` +
    (style.anchor ? ` text-anchor="${style.anchor}"` : '') +
    (style.weight ? ` font-weight="${style.weight}"` : '') +
    (style.spacing ? ` letter-spacing="${style.spacing}"` : '') +
    `>${escape(value)}</text>`
  )
}

function escape(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** Two decimals is plenty, and keeps the file free of 0.30000000000000004. */
function round(value: number): number {
  return Math.round(value * 100) / 100
}

function empty(title: string, options: SvgOptions): string {
  const background =
    options.background === null
      ? ''
      : `<rect width="240" height="80" fill="${options.background ?? COLOR.background}"/>`
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="80" viewBox="0 0 240 80">',
    `<title>${escape(title)}</title>`,
    background,
    text(120, 44, 'Nothing to draw', { font: SANS, size: 12, fill: COLOR.muted, anchor: 'middle' }),
    '</svg>',
    ''
  ].join('\n')
}

// ------------------------------------------------------------------- layout

/** Absolute boxes for every node, groups sized around their members. */
function layoutBoxes(diagram: Diagram, positions: Record<string, Point>): Map<string, Box> {
  const sizes = new Map<string, Size>()
  for (const node of diagram.nodes) sizes.set(node.id, measure(node))
  for (const node of diagram.nodes) {
    if (node.kind !== 'group') continue
    const members = diagram.nodes
      .filter((n) => n.parentId === node.id)
      .map((n) => ({
        position: positions[n.id] ?? { x: 0, y: 0 },
        size: sizes.get(n.id) as Size
      }))
    sizes.set(node.id, groupBox(members))
  }

  const boxes = new Map<string, Box>()
  const place = (node: DiagramNode): Box => {
    const known = boxes.get(node.id)
    if (known) return known

    const size = sizes.get(node.id) as Size
    const own = positions[node.id] ?? { x: 0, y: 0 }
    const parent = node.parentId
      ? diagram.nodes.find((n) => n.id === node.parentId)
      : undefined
    const origin = parent ? place(parent) : { x: 0, y: 0 }

    const box: Box = { x: origin.x + own.x, y: origin.y + own.y, ...size }
    boxes.set(node.id, box)
    return box
  }

  for (const node of diagram.nodes) place(node)
  return boxes
}
