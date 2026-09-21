/**
 * Turning a diagram into a file.
 *
 * The text formats come straight from the pure exporters in @shared/export.
 * PNG is drawn from the very same SVG: rasterising it here means the picture
 * and the vector file can never disagree, and it keeps a screen-capture
 * library out of the dependency list.
 */
import { EXPORT_TARGETS, renderText, toSvg, type ExportFormat } from '@shared/export'
import type { Diagram } from '@shared/dsl'
import type { Point } from '@shared/types'
import { api, call } from './api'

/** Retina-ish. A diagram is mostly text, and text wants the extra pixels. */
const PNG_SCALE = 2

export interface ExportRequest {
  docPath: string
  /** The document's title, written into the file's header. */
  title: string
  /** Base name for the file, without an extension. */
  fileName: string
  format: ExportFormat
  diagram: Diagram
  positions: Record<string, Point>
}

/** Writes the export beside the document and answers with where it landed. */
export async function exportDiagram(request: ExportRequest): Promise<string> {
  const target = EXPORT_TARGETS.find((t) => t.id === request.format)
  if (!target) throw new Error(`Unknown export format: ${request.format}`)
  const name = `${request.fileName}.${target.extension}`

  if (request.format === 'png') {
    const svg = toSvg(request.diagram, request.positions, request.title)
    return call(api.docs.export(request.docPath, name, await rasterize(svg), 'base64'))
  }

  const text = renderText(request.format, request.diagram, request.title, request.positions)
  return call(api.docs.export(request.docPath, name, text, 'utf8'))
}

/** Draw an SVG string onto a canvas and hand back base64 PNG bytes. */
async function rasterize(svg: string): Promise<string> {
  const { width, height } = sizeOf(svg)
  const image = new Image()
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
  await image.decode()

  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(width * PNG_SCALE))
  canvas.height = Math.max(1, Math.round(height * PNG_SCALE))
  const context = canvas.getContext('2d')
  if (!context) throw new Error('This system cannot draw to a canvas, so PNG export is unavailable')
  context.drawImage(image, 0, 0, canvas.width, canvas.height)

  return canvas.toDataURL('image/png').split(',')[1] ?? ''
}

/** The svg element carries its own size; no need to parse the whole document. */
function sizeOf(svg: string): { width: number; height: number } {
  const width = Number(/width="([\d.]+)"/.exec(svg)?.[1])
  const height = Number(/height="([\d.]+)"/.exec(svg)?.[1])
  return {
    width: Number.isFinite(width) ? width : 800,
    height: Number.isFinite(height) ? height : 600
  }
}
