// 브라우저 안에서 동작하는 /api/rr API (서버 rr/routes.js와 같은 주소·응답 형식)
import { getDb, save, newId, nowIso, storageKind } from './browser-store.js';
import { parseRnR } from '../rr/importer.js';
import { CYCLE_TYPES, UNITS, UNIT_LABEL, CYCLE_DEFAULTS, today, occurrences, suggestSchedule, isDate } from '../rr/schedule.js';
import * as svc from '../rr/service.js';

// 공유 파일 저장소가 그대로 받는 형식 (그 외 형식은 텍스트로 감싸 저장)
const NATIVE = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'video/mp4', 'video/webm', 'application/pdf', 'text/csv', 'text/markdown', 'application/json', 'text/plain']);
const MAX_FILE_MB = 15;

let assets = null;
let downloads = null;
export async function initCapabilities() {
  const use = (n) => (globalThis.claude?.use ? globalThis.claude.use(n).catch(() => null) : Promise.resolve(null));
  [assets, downloads] = await Promise.all([use('assets'), use('downloads')]);
}

const actor = (h) => (svc.listMembers().some((m) => m.id === h) ? h : null);
const findTask = (id) => {
  const k = getDb().tasks.find((x) => x.id === id);
  if (!k) throw new svc.HttpError(404, '업무를 찾을 수 없습니다.');
  return k;
};

function toBase64(buf) {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
function fromBase64(b64) {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

async function uploadFiles(taskId, files, actorId) {
  const k = findTask(taskId);
  if (!assets) throw new svc.HttpError(400, '이 화면에서는 파일을 올릴 수 없습니다. claude.ai에서 편집 권한으로 열어 주세요.');
  for (const f of files) {
    if (f.size > MAX_FILE_MB * 1024 * 1024) throw new svc.HttpError(400, `${f.name}: 파일은 ${MAX_FILE_MB}MB 이하만 올릴 수 있습니다.`);
  }
  for (const f of files) {
    const native = NATIVE.has(f.type);
    let r;
    try {
      r = native
        ? await assets.upload(f, { type: f.type })
        : await assets.upload(new Blob([toBase64(await f.arrayBuffer())], { type: 'text/plain' }), { type: 'text/plain' });
    } catch (e) {
      const msg = { too_large: '파일이 너무 큽니다.', quota_or_state: '파일 저장 공간이 가득 찼습니다.', rate_limited: '잠시 후 다시 시도해 주세요.' }[e?.code] || '파일을 올리지 못했습니다.';
      throw new svc.HttpError(400, `${f.name}: ${msg}`);
    }
    k.files.push({ id: newId('f'), assetId: r.id, name: f.name, size: f.size, mime: f.type || '', encoded: !native, at: nowIso(), uploaderId: actorId || null });
  }
  k.updatedAt = nowIso();
  save();
  return svc.getTask(taskId);
}

export async function downloadFile(fileId) {
  let f = null;
  for (const k of getDb().tasks) { f = k.files.find((x) => x.id === fileId); if (f) break; }
  if (!f) throw new Error('파일을 찾을 수 없습니다.');
  const res = await fetch(`/_blob/${f.assetId}`);
  if (!res.ok) throw new Error('파일을 불러오지 못했습니다. (삭제되었거나 접근 권한이 없습니다)');
  const data = f.encoded ? fromBase64((await res.text()).trim()) : await res.blob();
  if (!downloads) throw new Error('이 화면에서는 파일 저장을 지원하지 않습니다.');
  try {
    await downloads.save({ filename: f.name, data });
  } catch (e) {
    if (e?.code === 'declined') return;
    if (e?.code === 'rejected_extension' || e?.code === 'extension_not_enabled') throw new Error('이 파일 형식은 화면에서 내려받을 수 없습니다. (지원: pdf, xlsx, docx, pptx, csv, zip, 이미지 등)');
    throw new Error('파일을 저장하지 못했습니다.');
  }
}

async function removeAssets(list) {
  for (const f of list) { if (assets && f.assetId) await assets.delete(f.assetId).catch(() => {}); }
}

async function route(method, path, query, body, hdr) {
  const seg = path.split('/').filter(Boolean);
  const a = actor(hdr);
  const is = (m, ...p) => method === m && seg.length === p.length && p.every((x, i) => x === '*' || x === seg[i]);
  if (is('GET', 'meta')) {
    return { today: today(), cycleTypes: CYCLE_TYPES, units: UNITS, unitLabel: UNIT_LABEL, cycleDefaults: CYCLE_DEFAULTS, statuses: svc.ALL_STATUSES, maxFileMb: MAX_FILE_MB, storage: storageKind(), canUpload: !!assets };
  }
  if (is('GET', 'members')) return svc.listMembers();
  if (is('POST', 'members')) return svc.addMember(body || {});
  if (is('PUT', 'members', '*')) return svc.updateMember(seg[1], body || {});
  if (is('DELETE', 'members', '*')) return svc.deleteMember(seg[1]);
  if (is('GET', 'templates')) return svc.listTemplates();
  if (is('POST', 'templates')) return svc.createTemplate(body || {});
  if (is('POST', 'templates', 'bulk-active')) return svc.setTemplatesActive(body?.ids, body?.active);
  if (is('PUT', 'templates', '*')) return svc.updateTemplate(seg[1], body || {});
  if (is('DELETE', 'templates', '*')) return svc.deleteTemplate(seg[1]);
  if (is('POST', 'templates', '*', 'occur')) return svc.occurTask(seg[1], body || {}, a);
  if (is('POST', 'schedule', 'preview')) {
    const s = body || {};
    const from = isDate(s.startDate) ? s.startDate : today();
    return { dates: occurrences({ ...s, interval: Number(s.interval) }, from, '9999-12-31', 6) };
  }
  if (is('GET', 'schedule', 'suggest')) return suggestSchedule(query.get('cycleType'), query.get('note'));
  if (is('POST', 'import')) {
    const file = body?.get?.('file');
    if (!file) throw new svc.HttpError(400, '엑셀 파일을 선택해 주세요.');
    if (!globalThis.ExcelJS) throw new svc.HttpError(400, '엑셀 읽기 도구를 불러오지 못했습니다. 새로고침 후 다시 시도해 주세요.');
    let parsed;
    try { parsed = await parseRnR(await file.arrayBuffer()); } catch (e) { throw new svc.HttpError(400, e.message); }
    const r = svc.importParsed(parsed);
    svc.generate();
    return r;
  }
  if (is('POST', 'generate')) return svc.generate();
  if (is('GET', 'tasks')) {
    const q = Object.fromEntries(query.entries());
    return svc.queryTasks({ ...q, includePlanned: q.includePlanned === '1' });
  }
  if (is('GET', 'tasks', '*')) return svc.getTask(seg[1]);
  if (is('PUT', 'tasks', '*')) return svc.updateTask(seg[1], body || {}, a);
  if (is('DELETE', 'tasks', '*')) { await removeAssets(findTask(seg[1]).files); return svc.deleteTask(seg[1]); }
  if (is('POST', 'tasks', '*', 'logs')) return svc.addLog(seg[1], body || {}, a);
  if (is('POST', 'tasks', '*', 'files')) return uploadFiles(seg[1], body?.getAll?.('files') || [], a);
  if (is('DELETE', 'tasks', '*', 'files', '*')) {
    const k = findTask(seg[1]);
    const f = k.files.find((x) => x.id === seg[3]);
    if (!f) throw new svc.HttpError(404, '파일을 찾을 수 없습니다.');
    await removeAssets([f]);
    k.files = k.files.filter((x) => x.id !== f.id);
    save();
    return svc.getTask(seg[1]);
  }
  if (is('GET', 'calendar')) {
    const from = query.get('from'); const to = query.get('to');
    if (!isDate(from) || !isDate(to)) throw new svc.HttpError(400, 'from/to 날짜가 필요합니다.');
    return svc.queryTasks({ from, to, member: query.get('member') || '', role: query.get('role') || '', includePlanned: true });
  }
  if (is('GET', 'summary')) return svc.summary(Object.fromEntries(query.entries()));
  if (is('GET', 'notifications')) return svc.listNotifications(query.get('member') || '');
  if (is('POST', 'notifications', 'read')) return svc.readNotifications(String(body?.member || ''), body?.ids);
  throw new svc.HttpError(404, '알 수 없는 요청입니다.');
}

// 화면 코드의 fetch('/api/rr/...') 호출을 가로채 브라우저 안에서 처리
export function installFetch() {
  const orig = globalThis.fetch.bind(globalThis);
  globalThis.fetch = async (input, opt = {}) => {
    const url = typeof input === 'string' ? input : input.url;
    if (!url.startsWith('/api/rr/')) return orig(input, opt);
    const u = new URL(url, 'http://local');
    const path = u.pathname.slice('/api/rr/'.length);
    let body = opt.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
    const hdr = opt.headers?.['x-rr-member'] || '';
    try {
      const data = await route((opt.method || 'GET').toUpperCase(), path, u.searchParams, body, hdr);
      return new Response(JSON.stringify(data ?? {}), { status: 200, headers: { 'content-type': 'application/json' } });
    } catch (e) {
      const status = e.status || 500;
      if (status === 500) console.error('[RR]', e);
      return new Response(JSON.stringify({ error: e.message || '오류가 발생했습니다.' }), { status, headers: { 'content-type': 'application/json' } });
    }
  };
}
