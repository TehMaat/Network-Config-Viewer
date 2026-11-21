// Excel files made in the browser (#10): ExcelJS (MIT) is loaded only when a file is asked
// for, and the file goes straight to the user's downloads.

import type * as ExcelJS from 'exceljs';

export type Cell = string | number | null | undefined;

export interface Sheet {
  /** Name of the sheet: shortened and made unique as Excel wants. */
  name: string;
  columns: string[];
  rows: Cell[][];
}

export const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const FORBIDDEN = /[:\\/?*[\]]/g;

/** Excel: at most 31 characters, none of : \ / ? * [ ], unique without regard to case. */
export function sheetName(name: string, used: Set<string>): string {
  const base = (
    name
      .replace(FORBIDDEN, ' ')
      .replace(/^'+|'+$/g, '')
      .trim() || 'Sheet'
  ).slice(0, 31);
  let candidate = base;
  for (let n = 2; used.has(candidate.toLowerCase()); n++) {
    const suffix = ` (${n})`;
    candidate = `${base.slice(0, 31 - suffix.length)}${suffix}`;
  }
  used.add(candidate.toLowerCase());
  return candidate;
}

/** Width of a column: its longest text, within limits. */
function width(sheet: Sheet, column: number): number {
  let longest = sheet.columns[column]?.length ?? 0;
  for (const row of sheet.rows) {
    const length = String(row[column] ?? '').length;
    if (length > longest) longest = length;
  }
  return Math.min(60, Math.max(8, longest + 2));
}

/** A workbook with one sheet each: bold header, frozen first row, filters, column widths. */
export async function workbookBlob(sheets: Sheet[]): Promise<Blob> {
  const module = (await import('exceljs')) as typeof ExcelJS & { default?: typeof ExcelJS };
  const { Workbook } = module.default ?? module;
  const workbook = new Workbook();
  workbook.creator = 'Network Config Viewer';
  const used = new Set<string>();
  for (const sheet of sheets) {
    const ws = workbook.addWorksheet(sheetName(sheet.name, used), {
      views: [{ state: 'frozen', ySplit: 1 }],
    });
    ws.addRow(sheet.columns);
    ws.getRow(1).font = { bold: true };
    // Values stay values: text is never read as a formula.
    for (const row of sheet.rows)
      ws.addRow(row.map((cell) => (cell === '' ? null : (cell ?? null))));
    sheet.columns.forEach((_, i) => {
      ws.getColumn(i + 1).width = width(sheet, i);
    });
    if (sheet.columns.length > 0) {
      ws.autoFilter = {
        from: { row: 1, column: 1 },
        to: { row: Math.max(1, sheet.rows.length + 1), column: sheet.columns.length },
      };
    }
  }
  const buffer = await workbook.xlsx.writeBuffer();
  return new Blob([buffer], { type: XLSX_TYPE });
}
