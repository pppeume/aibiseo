// 업무분장(R&R) 엑셀 → 업무 표준(템플릿) 변환
import ExcelJS from 'exceljs';
import { CYCLE_TYPES } from './schedule.js';

const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const compact = (s) => String(s ?? '').replace(/\s+/g, '');

function text(cell) {
  const v = cell?.value;
  if (v == null) return '';
  if (typeof v === 'object') {
    if (Array.isArray(v.richText)) return v.richText.map((t) => t.text).join('');
    if ('result' in v) return v.result == null ? '' : String(v.result);
    if ('text' in v) return String(v.text);
    if (v instanceof Date) return v.toISOString().slice(0, 10);
  }
  return String(v);
}

/**
 * @returns {{ members: string[], rows: object[], warnings: string[], sheet: string }}
 * rows: { cat1, cat2, cat3, detail, automation, cycleType, mains:[name], subs:[name], note }
 */
export async function parseRnR(buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const warnings = [];

  // '대분류' 머리글이 있는 시트를 찾는다 (업무분장(R&R) 시트 우선)
  const sheets = [...wb.worksheets].sort((a, b) => (/R&R|업무분장/.test(b.name) ? 1 : 0) - (/R&R|업무분장/.test(a.name) ? 1 : 0));
  let ws = null;
  let hr = 0;
  for (const s of sheets) {
    for (let r = 1; r <= Math.min(s.rowCount, 30); r++) {
      if (compact(text(s.getRow(r).getCell(1))) === '대분류') { ws = s; hr = r; break; }
    }
    if (ws) break;
  }
  if (!ws) throw new Error("'대분류' 머리글이 있는 시트를 찾지 못했습니다. 업무분장(R&R) 형식의 엑셀인지 확인해 주세요.");

  const head = ws.getRow(hr);
  const sub = ws.getRow(hr + 1);
  const cols = { memberCols: [], cycleCols: [] };
  const colCount = Math.max(ws.columnCount, head.cellCount);
  for (let c = 1; c <= colCount; c++) {
    const h = compact(text(head.getCell(c)));
    const sh = clean(text(sub.getCell(c)));
    if (h === '대분류') cols.cat1 = c;
    else if (h === '중분류') cols.cat2 = c;
    else if (h === '소분류') cols.cat3 = c;
    else if (h.startsWith('상세업무')) cols.detail = c;
    else if (h.startsWith('자동화')) cols.automation = c;
    else if (h === '비고') cols.note = c;
    else if (h === '업무수행' && sh) cols.memberCols.push({ c, name: sh });
    else if (h === '수행주기' && sh) {
      const cyc = compact(sh) === '발생시' ? '발생시' : compact(sh);
      if (CYCLE_TYPES.includes(cyc)) cols.cycleCols.push({ c, cycle: cyc });
      else warnings.push(`알 수 없는 수행 주기 머리글: ${sh}`);
    }
  }
  for (const k of ['cat1', 'cat2', 'cat3']) if (!cols[k]) throw new Error(`'${k === 'cat1' ? '대분류' : k === 'cat2' ? '중분류' : '소분류'}' 열을 찾지 못했습니다.`);
  if (!cols.memberCols.length) throw new Error("'업무 수행' 아래 담당자 열을 찾지 못했습니다.");
  if (!cols.cycleCols.length) throw new Error("'수행 주기' 열을 찾지 못했습니다.");

  const rows = [];
  let cat1 = '';
  let cat2 = '';
  for (let r = hr + 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const c1 = clean(text(row.getCell(cols.cat1)));
    const c2 = clean(text(row.getCell(cols.cat2)));
    const c3 = clean(text(row.getCell(cols.cat3)));
    if (c1) { if (c1 !== cat1) cat2 = ''; cat1 = c1; }
    if (c2) cat2 = c2;
    if (!c3) continue;

    const mains = [];
    const subs = [];
    for (const { c, name } of cols.memberCols) {
      const v = clean(text(row.getCell(c)));
      if (v === '★') mains.push(name);
      else if (v === '○') subs.push(name);
    }
    const cycles = cols.cycleCols.filter(({ c }) => clean(text(row.getCell(c))) !== '').map((x) => x.cycle);
    if (!cycles.length) warnings.push(`${r}행 '${c3}': 수행 주기 표시가 없어 '발생시'로 등록했습니다.`);
    if (cycles.length > 1) warnings.push(`${r}행 '${c3}': 수행 주기가 여러 개(${cycles.join(', ')})여서 첫 번째(${cycles[0]})로 등록했습니다.`);
    if (!mains.length) warnings.push(`${r}행 '${c3}': 메인 담당자(★)가 없습니다.`);

    rows.push({
      cat1,
      cat2,
      cat3: c3,
      detail: String(text(row.getCell(cols.detail || 0)) || '').trim(),
      automation: cols.automation ? clean(text(row.getCell(cols.automation))) : '',
      cycleType: cycles[0] || '발생시',
      mains,
      subs,
      note: cols.note ? clean(text(row.getCell(cols.note))) : '',
      sourceRow: r,
    });
  }
  return { sheet: ws.name, members: cols.memberCols.map((m) => m.name), rows, warnings };
}
