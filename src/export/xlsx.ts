/** 最小構成の xlsx ライタ。
 *
 * 数式入りのブックを出せれば十分なので、共有文字列テーブルは使わず inlineStr で書く。
 * calcPr の fullCalcOnLoad を立てておくと、開いた瞬間に Excel 側で全再計算される。
 */

import { strToU8, zipSync } from 'fflate'
import type { SheetPlan, SheetRow, RowStyle } from '../engine/excel.ts'

const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** styles.xml の cellXfs のどれを使うか */
const STYLE_INDEX: Record<RowStyle, number> = {
  title: 1,
  section: 2,
  variable: 3,
  input: 4,
  calc: 4,
  output: 6,
  result: 7,
  blank: 0,
}

const COLUMNS = ['A', 'B', 'C', 'D'] as const

function textCell(colRow: string, s: number, text: string): string {
  return `<c r="${colRow}" s="${s}" t="inlineStr"><is><t xml:space="preserve">${esc(text)}</t></is></c>`
}

function numberCell(colRow: string, s: number, v: number): string {
  return `<c r="${colRow}" s="${s}"><v>${v}</v></c>`
}

function formulaCell(colRow: string, s: number, formula: string, cached?: number): string {
  const v = cached !== undefined && Number.isFinite(cached) ? `<v>${cached}</v>` : ''
  return `<c r="${colRow}" s="${s}"><f>${esc(formula)}</f>${v}</c>`
}

function rowXml(r: SheetRow): string {
  const s = STYLE_INDEX[r.style]
  const muted = r.style === 'title' ? s : 8
  const cells: string[] = []

  if (r.name !== undefined) cells.push(textCell(`${COLUMNS[0]}${r.row}`, s, r.name))

  const b = `${COLUMNS[1]}${r.row}`
  if (r.formula) cells.push(formulaCell(b, s, r.formula, r.cached))
  else if (r.value !== undefined && Number.isFinite(r.value)) cells.push(numberCell(b, s, r.value))

  if (r.source) cells.push(textCell(`${COLUMNS[2]}${r.row}`, muted, r.source))
  if (r.note) cells.push(textCell(`${COLUMNS[3]}${r.row}`, muted, r.note))

  if (!cells.length) return ''
  return `<row r="${r.row}">${cells.join('')}</row>`
}

function sheetXml(plan: SheetPlan): string {
  const last = plan.rows.length || 1
  return (
    XML_HEAD +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    `<dimension ref="A1:D${last}"/>` +
    '<sheetViews><sheetView workbookViewId="0" showGridLines="0"/></sheetViews>' +
    '<sheetFormatPr defaultRowHeight="18"/>' +
    '<cols>' +
    '<col min="1" max="1" width="26" customWidth="1"/>' +
    '<col min="2" max="2" width="16" customWidth="1"/>' +
    '<col min="3" max="3" width="46" customWidth="1"/>' +
    '<col min="4" max="4" width="20" customWidth="1"/>' +
    '</cols>' +
    '<sheetData>' +
    plan.rows.map(rowXml).join('') +
    '</sheetData>' +
    '</worksheet>'
  )
}

const STYLES_XML =
  XML_HEAD +
  '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
  '<fonts count="4">' +
  '<font><sz val="11"/><color rgb="FF1F2933"/><name val="Calibri"/></font>' +
  '<font><b/><sz val="11"/><color rgb="FF1F2933"/><name val="Calibri"/></font>' +
  '<font><b/><sz val="12"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>' +
  '<font><sz val="10"/><color rgb="FF7A8794"/><name val="Calibri"/></font>' +
  '</fonts>' +
  '<fills count="6">' +
  '<fill><patternFill patternType="none"/></fill>' +
  '<fill><patternFill patternType="gray125"/></fill>' +
  '<fill><patternFill patternType="solid"><fgColor rgb="FF1F2933"/><bgColor indexed="64"/></patternFill></fill>' +
  '<fill><patternFill patternType="solid"><fgColor rgb="FFE7F0FA"/><bgColor indexed="64"/></patternFill></fill>' +
  '<fill><patternFill patternType="solid"><fgColor rgb="FFEDF0F3"/><bgColor indexed="64"/></patternFill></fill>' +
  '<fill><patternFill patternType="solid"><fgColor rgb="FFE1F4EA"/><bgColor indexed="64"/></patternFill></fill>' +
  '</fills>' +
  '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
  '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
  '<cellXfs count="9">' +
  '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
  '<xf numFmtId="0" fontId="2" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>' +
  '<xf numFmtId="0" fontId="1" fillId="4" borderId="0" xfId="0" applyFont="1" applyFill="1"/>' +
  '<xf numFmtId="0" fontId="0" fillId="3" borderId="0" xfId="0" applyFill="1"/>' +
  '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
  '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
  '<xf numFmtId="0" fontId="1" fillId="5" borderId="0" xfId="0" applyFont="1" applyFill="1"/>' +
  '<xf numFmtId="0" fontId="1" fillId="5" borderId="0" xfId="0" applyFont="1" applyFill="1"/>' +
  '<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
  '</cellXfs>' +
  '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
  '</styleSheet>'

const CONTENT_TYPES =
  XML_HEAD +
  '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
  '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
  '<Default Extension="xml" ContentType="application/xml"/>' +
  '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
  '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
  '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
  '</Types>'

const ROOT_RELS =
  XML_HEAD +
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
  '</Relationships>'

const WORKBOOK_RELS =
  XML_HEAD +
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
  '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
  '</Relationships>'

function workbookXml(sheetName: string): string {
  return (
    XML_HEAD +
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    `<sheets><sheet name="${esc(sheetName)}" sheetId="1" r:id="rId1"/></sheets>` +
    '<calcPr calcId="191029" fullCalcOnLoad="1"/>' +
    '</workbook>'
  )
}

/** シート計画から xlsx のバイト列を作る。 */
export function buildXlsx(plan: SheetPlan, sheetName = '計算'): Uint8Array<ArrayBuffer> {
  return zipSync(
    {
      '[Content_Types].xml': strToU8(CONTENT_TYPES),
      '_rels/.rels': strToU8(ROOT_RELS),
      'xl/workbook.xml': strToU8(workbookXml(sheetName)),
      'xl/_rels/workbook.xml.rels': strToU8(WORKBOOK_RELS),
      'xl/styles.xml': strToU8(STYLES_XML),
      'xl/worksheets/sheet1.xml': strToU8(sheetXml(plan)),
    },
    { level: 6, mtime: new Date() },
  )
}

export function downloadBlob(data: BlobPart, filename: string, type: string): void {
  const url = URL.createObjectURL(new Blob([data], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
