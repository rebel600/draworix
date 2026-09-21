/**
 * Export targets.
 *
 * Every exporter is a pure function from the parsed diagram to a string, so
 * they are as testable as the parser and could run in the main process one
 * day. PNG is the exception: rasterising is the renderer's job, and it does
 * it by drawing the SVG this module produces.
 */
import type { Diagram } from '../dsl'
import type { Point } from '../types'
import { toDbml } from './dbml'
import { toPrisma } from './prisma'
import { toSql } from './sql'
import { toSvg } from './svg'

export { toDbml, toPrisma, toSql, toSvg }
export type { SvgOptions } from './svg'

export type ExportFormat = 'sql' | 'prisma' | 'dbml' | 'svg' | 'png'

export interface ExportTarget {
  id: ExportFormat
  label: string
  extension: string
  /** Describes a schema, so it only means anything for an ERD. */
  schemaOnly: boolean
}

export const EXPORT_TARGETS: readonly ExportTarget[] = [
  { id: 'sql', label: 'SQL', extension: 'sql', schemaOnly: true },
  { id: 'prisma', label: 'Prisma', extension: 'prisma', schemaOnly: true },
  { id: 'dbml', label: 'DBML', extension: 'dbml', schemaOnly: true },
  { id: 'svg', label: 'SVG', extension: 'svg', schemaOnly: false },
  { id: 'png', label: 'PNG', extension: 'png', schemaOnly: false }
]

/** The targets that make sense for a diagram of this type. */
export function targetsFor(type: Diagram['type']): ExportTarget[] {
  return EXPORT_TARGETS.filter((target) => !target.schemaOnly || type === 'erd')
}

/**
 * Render a text format. PNG is not one: it is built from the SVG by the
 * renderer, which is the only place with a canvas to draw on.
 */
export function renderText(
  format: Exclude<ExportFormat, 'png'>,
  diagram: Diagram,
  title: string,
  positions: Record<string, Point>
): string {
  switch (format) {
    case 'sql':
      return toSql(diagram, title)
    case 'prisma':
      return toPrisma(diagram, title)
    case 'dbml':
      return toDbml(diagram, title)
    case 'svg':
      return toSvg(diagram, positions, title)
  }
}
