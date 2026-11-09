// 업무 표준·업무 생성·처리·알림 비즈니스 로직
import fs from 'fs';
import path from 'path';
import { getDb, save, newId, nowIso, UPLOAD_DIR } from './store.js';
import {
  CYCLE_TYPES, UNITS, isDate, today, addDays, occurrences, suggestSchedule, describeSchedule,
} from './schedule.js';

export const TASK_STATUSES = ['예정', '진행중', '완료']; // 실제 생성된 업무의 상태
export const ALL_STATUSES = ['계획', ...TASK_STATUSES]; // '계획' = 아직 생성 전인 주기 업무(예측)

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const bad = (msg) => new HttpError(400, msg);
const notFound = (what) => new HttpError(404, `${what}을(를) 찾을 수 없습니다.`);
const str = (v, max = 2000) => String(v ?? '').trim().slice(0, max);

// ---------------- 담당자 ----------------
export function listMembers() {
  return getDb().members;
}
export function addMember({ name, title = '', role = '' }) {
  const db = getDb();
  name = str(name, 50);
  if (!name) throw bad('담당자 이름을 입력해 주세요.');
  if (db.members.some((m) => m.name === name && m.active !== false)) throw bad(`이미 등록된 담당자입니다: ${name}`);
  const m = { id: newId('m'), name, title: str(title, 50), role: str(role, 200), active: true };
  db.members.push(m);
  save();
  return m;
}
export function updateMember(id, body) {
  const m = getDb().members.find((x) => x.id === id);
  if (!m) throw notFound('담당자');
  if (body.name !== undefined) { const n = str(body.name, 50); if (!n) throw bad('이름은 비울 수 없습니다.'); m.name = n; }
  if (body.title !== undefined) m.title = str(body.title, 50);
  if (body.role !== undefined) m.role = str(body.role, 200);
  if (body.active !== undefined) m.active = !!body.active;
  save();
  return m;
}
export function deleteMember(id) {
  const db = getDb();
  const m = db.members.find((x) => x.id === id);
  if (!m) throw notFound('담당자');
  const used = db.templates.some((t) => t.mains.includes(id) || t.subs.includes(id))
    || db.tasks.some((t) => t.mains.includes(id) || t.subs.includes(id));
  if (used) { m.active = false; save(); return { deactivated: true }; } // 이력 보존을 위해 비활성화
  db.members = db.members.filter((x) => x.id !== id);
  save();
  return { deleted: true };
}
// 로그인 계정(claude.ai 사용자 ID 등 불투명 ID)과 담당자 연결 — 한 계정은 한 담당자에만 연결
export function linkMember(id, userId) {
  const db = getDb();
  const m = db.members.find((x) => x.id === id);
  if (!m) throw notFound('담당자');
  const uid = str(userId, 200);
  if (!uid) throw bad('연결할 계정 정보가 없습니다.');
  for (const x of db.members) if (x.userId === uid && x.id !== id) delete x.userId;
  m.userId = uid;
  save();
  return m;
}
export function unlinkMember(id) {
  const m = getDb().members.find((x) => x.id === id);
  if (!m) throw notFound('담당자');
  delete m.userId;
  save();
  return m;
}
const memberIds = (arr, label) => {
  const ids = [...new Set((Array.isArray(arr) ? arr : []).map(String))];
  const known = new Set(getDb().members.map((m) => m.id));
  const unknown = ids.filter((i) => !known.has(i));
  if (unknown.length) throw bad(`${label}에 존재하지 않는 담당자가 있습니다.`);
  return ids;
};
const nameOf = (id) => getDb().members.find((m) => m.id === id)?.name || '(삭제됨)';

// ---------------- 업무 표준(템플릿) ----------------
function validateSchedule(s) {
  if (!s || typeof s !== 'object') throw bad('반복 주기를 입력해 주세요.');
  const unit = String(s.unit);
  if (!UNITS.includes(unit)) throw bad('주기 단위(일/주/월/분기/년)를 선택해 주세요.');
  const interval = Number(s.interval);
  if (!Number.isInteger(interval) || interval < 1 || interval > 365) throw bad('주기 간격은 1~365 사이 정수여야 합니다.');
  if (!isDate(s.startDate)) throw bad('기준일을 입력해 주세요.');
  const endDate = s.endDate ? String(s.endDate) : '';
  if (endDate && (!isDate(endDate) || endDate < s.startDate)) throw bad('종료일은 기준일 이후여야 합니다.');
  const leadDays = Number(s.leadDays ?? 0);
  if (!Number.isInteger(leadDays) || leadDays < 0 || leadDays > 365) throw bad('사전 생성 일수는 0~365 사이 정수여야 합니다.');
  return { unit, interval, startDate: s.startDate, endDate, leadDays, skipWeekends: unit === 'day' && !!s.skipWeekends };
}

function applyTemplateFields(t, body, { partial }) {
  const has = (k) => body[k] !== undefined;
  for (const k of ['cat1', 'cat2', 'cat3']) {
    if (!partial || has(k)) {
      const v = str(body[k], 200);
      if (!v) throw bad(`${k === 'cat1' ? '대분류' : k === 'cat2' ? '중분류' : '소분류'}를 입력해 주세요.`);
      t[k] = v;
    }
  }
  if (!partial || has('detail')) t.detail = str(body.detail);
  if (!partial || has('automation')) t.automation = str(body.automation, 20);
  if (!partial || has('note')) t.note = str(body.note, 500);
  if (!partial || has('cycleType')) {
    if (!CYCLE_TYPES.includes(body.cycleType)) throw bad('업무 구분(발생 시/매일/매주/매월/매분기/매반기/매년)을 선택해 주세요.');
    t.cycleType = body.cycleType;
  }
  if (!partial || has('mains')) t.mains = memberIds(body.mains, '메인 담당자');
  if (!partial || has('subs')) t.subs = memberIds(body.subs, '서브 담당자');
  t.subs = (t.subs || []).filter((id) => !t.mains.includes(id));
  if (!t.mains.length) throw bad('메인 담당자를 1명 이상 선택해 주세요.');
  if (t.cycleType === '발생시') t.schedule = null;
  else if (!partial || has('schedule') || !t.schedule) t.schedule = validateSchedule(body.schedule ?? t.schedule);
  if (!partial || has('active')) {
    const active = !!body.active;
    if (active && !t.active) t.activatedOn = today();
    t.active = active;
  }
  t.needsReview = false; // 사람이 저장하면 검토 완료로 간주
}

export function listTemplates() {
  return getDb().templates.map((t) => ({ ...t, scheduleText: describeSchedule(t) }));
}
export function createTemplate(body) {
  const t = { id: newId('t'), createdAt: nowIso() };
  applyTemplateFields(t, body, { partial: false });
  t.updatedAt = nowIso();
  getDb().templates.push(t);
  save();
  generate();
  return t;
}
export function updateTemplate(id, body) {
  const t = getDb().templates.find((x) => x.id === id);
  if (!t) throw notFound('업무 표준');
  applyTemplateFields(t, body, { partial: true });
  t.updatedAt = nowIso();
  save();
  generate();
  return t;
}
export function deleteTemplate(id) {
  const db = getDb();
  if (!db.templates.some((x) => x.id === id)) throw notFound('업무 표준');
  db.templates = db.templates.filter((x) => x.id !== id);
  save(); // 이미 생성된 업무는 기록으로 유지
  return { deleted: true };
}
export function setTemplatesActive(ids, active) {
  const set = new Set(ids || []);
  let n = 0;
  for (const t of getDb().templates) {
    if (!set.has(t.id)) continue;
    if (active && t.cycleType !== '발생시' && !t.schedule) continue;
    if (active && !t.active) t.activatedOn = today();
    t.active = !!active;
    t.needsReview = false;
    t.updatedAt = nowIso();
    n++;
  }
  save();
  generate();
  return { updated: n };
}

// ---------------- 엑셀 가져오기 ----------------
const keyOf = (r) => `${r.cat1}|${r.cat2}|${r.cat3}`;

export function importParsed(parsed) {
  const db = getDb();
  const byName = new Map(db.members.map((m) => [m.name, m]));
  const addedMembers = [];
  for (const name of parsed.members) {
    if (!byName.has(name)) {
      const m = { id: newId('m'), name, title: '', role: '', active: true };
      db.members.push(m); byName.set(name, m); addedMembers.push(name);
    }
  }
  const ids = (names) => names.map((n) => byName.get(n)?.id).filter(Boolean);
  const existing = new Map(db.templates.map((t) => [keyOf(t), t]));
  let created = 0; let updated = 0; let unchanged = 0;
  for (const r of parsed.rows) {
    const fields = {
      cat1: r.cat1, cat2: r.cat2, cat3: r.cat3, detail: r.detail, automation: r.automation,
      note: r.note, cycleType: r.cycleType, mains: ids(r.mains), subs: ids(r.subs),
    };
    const t = existing.get(keyOf(r));
    if (!t) {
      db.templates.push({
        id: newId('t'), ...fields,
        // 기준일은 엑셀에 없으므로 '제안값'으로 채우고 미확정(비활성) 상태로 둔다
        schedule: r.cycleType === '발생시' ? null : { ...suggestSchedule(r.cycleType, r.note) },
        active: r.cycleType === '발생시', // 발생 시 업무는 바로 사용 가능
        activatedOn: r.cycleType === '발생시' ? today() : null,
        needsReview: r.cycleType !== '발생시',
        source: 'excel', createdAt: nowIso(), updatedAt: nowIso(),
      });
      created++;
      continue;
    }
    const before = JSON.stringify([t.detail, t.automation, t.note, t.cycleType, t.mains, t.subs]);
    const cycleChanged = t.cycleType !== fields.cycleType;
    Object.assign(t, fields);
    if (cycleChanged) {
      t.schedule = fields.cycleType === '발생시' ? null : { ...suggestSchedule(fields.cycleType, fields.note) };
      t.active = fields.cycleType === '발생시';
      t.needsReview = fields.cycleType !== '발생시';
    }
    if (JSON.stringify([t.detail, t.automation, t.note, t.cycleType, t.mains, t.subs]) === before) unchanged++;
    else { updated++; t.updatedAt = nowIso(); }
  }
  save();
  return { sheet: parsed.sheet, total: parsed.rows.length, created, updated, unchanged, addedMembers, warnings: parsed.warnings };
}

// ---------------- 업무(인스턴스) 생성 ----------------
function notify(memberIdsList, taskId, type, message, exceptId, key) {
  const db = getDb();
  for (const mid of new Set(memberIdsList)) {
    if (mid === exceptId) continue;
    // key가 있으면 결정적 ID 사용 → 여러 화면이 동시에 생성해도 중복 알림이 생기지 않음
    const id = key ? `n_${key}_${mid}` : newId('n');
    if (key && db.notifications.some((n) => n.id === id)) continue;
    db.notifications.push({ id, memberId: mid, taskId, type, message, at: nowIso(), read: false });
  }
  if (db.notifications.length > 5000) db.notifications = db.notifications.slice(-5000);
}

function makeTask(t, { plannedDate, dueDate, kind, memo, actorId }) {
  const task = {
    // 주기 업무는 (업무표준, 발생일)로 결정되는 ID → 중복 생성 방지
    id: kind === 'cycle' ? `k_${t.id}_${plannedDate}` : newId('k'), templateId: t.id, kind, cycleType: t.cycleType,
    cat1: t.cat1, cat2: t.cat2, cat3: t.cat3, detail: t.detail,
    mains: [...t.mains], subs: [...t.subs],
    plannedDate, dueDate: dueDate || plannedDate, dueConfirmed: !!dueDate && kind === 'occur',
    status: '예정', logs: [], files: [], createdAt: nowIso(), completedAt: null,
  };
  if (memo) task.logs.push({ id: newId('l'), at: nowIso(), authorId: actorId || null, text: str(memo), system: false });
  getDb().tasks.push(task);
  const label = kind === 'occur' ? '발생 업무' : `${t.cycleType} 업무`;
  notify([...task.mains, ...task.subs], task.id, 'assigned', `[${label}] ${t.cat3} (처리기한 ${task.dueDate})`, actorId, kind === 'cycle' ? task.id : null);
  return task;
}

/** 활성 주기 업무 중 '전달 시점(발생일 - 사전 생성 일수)'이 도래한 회차를 업무로 생성 */
export function generate(todayStr = today()) {
  const db = getDb();
  const exists = new Set(db.tasks.filter((k) => k.kind === 'cycle').map((k) => `${k.templateId}|${k.plannedDate}`));
  let created = 0;
  for (const t of db.templates) {
    if (!t.active || t.cycleType === '발생시' || !t.schedule) continue;
    const from = t.activatedOn && t.activatedOn > t.schedule.startDate ? t.activatedOn : t.schedule.startDate;
    const to = addDays(todayStr, t.schedule.leadDays || 0);
    for (const d of occurrences(t.schedule, from, to)) {
      if (exists.has(`${t.id}|${d}`)) continue;
      makeTask(t, { plannedDate: d, kind: 'cycle' });
      exists.add(`${t.id}|${d}`);
      created++;
    }
  }
  if (created) save();
  return { created, date: todayStr };
}

/** 아직 생성되지 않은 미래 회차(= '계획') */
export function projections(from, to, todayStr = today()) {
  const db = getDb();
  const exists = new Set(db.tasks.filter((k) => k.kind === 'cycle').map((k) => `${k.templateId}|${k.plannedDate}`));
  const out = [];
  for (const t of db.templates) {
    if (!t.active || t.cycleType === '발생시' || !t.schedule) continue;
    const lead = t.schedule.leadDays || 0;
    const minFrom = [from, t.activatedOn || '', addDays(todayStr, lead + 1)].sort().pop();
    for (const d of occurrences(t.schedule, minFrom, to)) {
      if (exists.has(`${t.id}|${d}`)) continue;
      out.push({
        id: `plan:${t.id}:${d}`, virtual: true, templateId: t.id, kind: 'cycle', cycleType: t.cycleType,
        cat1: t.cat1, cat2: t.cat2, cat3: t.cat3, detail: t.detail, mains: t.mains, subs: t.subs,
        plannedDate: d, dueDate: d, status: '계획', releaseDate: addDays(d, -lead), logs: [], files: [],
      });
    }
  }
  return out;
}

export function occurTask(templateId, body, actorId) {
  const t = getDb().templates.find((x) => x.id === templateId);
  if (!t) throw notFound('업무 표준');
  const plannedDate = body.plannedDate || today();
  if (!isDate(plannedDate)) throw bad('발생일 형식이 올바르지 않습니다.');
  if (body.dueDate && !isDate(body.dueDate)) throw bad('처리기한 형식이 올바르지 않습니다.');
  const task = makeTask(t, { plannedDate, dueDate: body.dueDate, kind: 'occur', memo: body.memo, actorId });
  save();
  return task;
}

// ---------------- 업무 조회·처리 ----------------
export const isOverdue = (k, todayStr = today()) => k.status !== '완료' && k.status !== '계획' && k.dueDate < todayStr;
const decorate = (k, todayStr) => ({ ...k, overdue: isOverdue(k, todayStr) });

function matchMember(k, memberId, role) {
  if (!memberId) return true;
  if (role === 'main') return k.mains.includes(memberId);
  if (role === 'sub') return k.subs.includes(memberId);
  return k.mains.includes(memberId) || k.subs.includes(memberId);
}

export function queryTasks(q = {}) {
  const todayStr = today();
  const { member, role, status, from, to, cycleType, text, includePlanned } = q;
  let list = getDb().tasks.map((k) => decorate(k, todayStr));
  if (includePlanned && from && to) list = list.concat(projections(from, to, todayStr).map((k) => decorate(k, todayStr)));
  return list
    .filter((k) => matchMember(k, member, role))
    .filter((k) => !status || (status === '지연' ? k.overdue : k.status === status))
    .filter((k) => !cycleType || k.cycleType === cycleType)
    .filter((k) => !from || k.dueDate >= from)
    .filter((k) => !to || k.dueDate <= to)
    .filter((k) => !text || `${k.cat1} ${k.cat2} ${k.cat3} ${k.detail}`.includes(text))
    .sort((a, b) => (a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : a.cat3.localeCompare(b.cat3, 'ko')));
}

const findTask = (id) => {
  const k = getDb().tasks.find((x) => x.id === id);
  if (!k) throw notFound('업무');
  return k;
};
export const getTask = (id) => decorate(findTask(id), today());

export function updateTask(id, body, actorId) {
  const k = findTask(id);
  const changes = [];
  if (body.dueDate !== undefined) {
    if (!isDate(body.dueDate)) throw bad('처리기한 형식이 올바르지 않습니다.');
    if (body.dueDate !== k.dueDate) changes.push(`처리기한 ${k.dueDate} → ${body.dueDate}`);
    k.dueDate = body.dueDate;
    k.dueConfirmed = true;
  }
  if (body.mains !== undefined) { k.mains = memberIds(body.mains, '메인 담당자'); if (!k.mains.length) throw bad('메인 담당자를 1명 이상 선택해 주세요.'); }
  if (body.subs !== undefined) k.subs = memberIds(body.subs, '서브 담당자').filter((m) => !k.mains.includes(m));
  if (body.status !== undefined) {
    if (!TASK_STATUSES.includes(body.status)) throw bad('상태 값이 올바르지 않습니다.');
    if (body.status !== k.status) {
      changes.push(`상태 ${k.status} → ${body.status}`);
      k.status = body.status;
      k.completedAt = body.status === '완료' ? nowIso() : null;
      if (body.status === '완료') notify([...k.mains, ...k.subs], k.id, 'done', `[완료] ${k.cat3} — ${actorId ? nameOf(actorId) : ''}`, actorId);
    }
  }
  if (changes.length) k.logs.push({ id: newId('l'), at: nowIso(), authorId: actorId || null, text: changes.join(', '), system: true });
  k.updatedAt = nowIso();
  save();
  return decorate(k, today());
}

export function addLog(id, { text }, actorId) {
  const k = findTask(id);
  const t = str(text, 5000);
  if (!t) throw bad('처리 현황 내용을 입력해 주세요.');
  k.logs.push({ id: newId('l'), at: nowIso(), authorId: actorId || null, text: t, system: false });
  if (k.status === '예정') { // 현황을 입력하면 자동으로 '진행중'
    k.status = '진행중';
    k.logs.push({ id: newId('l'), at: nowIso(), authorId: actorId || null, text: '상태 예정 → 진행중 (처리 현황 입력)', system: true });
  }
  notify([...k.mains, ...k.subs], k.id, 'log', `[현황] ${k.cat3}: ${t.slice(0, 60)}`, actorId);
  k.updatedAt = nowIso();
  save();
  return decorate(k, today());
}

export function addFiles(id, files, actorId) {
  const k = findTask(id);
  for (const f of files) {
    k.files.push({
      id: newId('f'), name: Buffer.from(f.originalname, 'latin1').toString('utf8'),
      stored: path.basename(f.filename), size: f.size, mime: f.mimetype, at: nowIso(), uploaderId: actorId || null,
    });
  }
  if (files.length) notify([...k.mains, ...k.subs], k.id, 'file', `[파일] ${k.cat3}: ${files.length}개 업로드`, actorId);
  k.updatedAt = nowIso();
  save();
  return decorate(k, today());
}

export function getFile(fileId) {
  for (const k of getDb().tasks) {
    const f = k.files.find((x) => x.id === fileId);
    if (f) return { ...f, path: path.join(UPLOAD_DIR, f.stored) };
  }
  throw notFound('파일');
}

export function deleteFile(taskId, fileId) {
  const k = findTask(taskId);
  const f = k.files.find((x) => x.id === fileId);
  if (!f) throw notFound('파일');
  k.files = k.files.filter((x) => x.id !== fileId);
  fs.rmSync(path.join(UPLOAD_DIR, f.stored), { force: true });
  save();
  return decorate(k, today());
}

export function deleteTask(id) {
  const db = getDb();
  const k = findTask(id);
  for (const f of k.files) fs.rmSync(path.join(UPLOAD_DIR, f.stored), { force: true });
  db.tasks = db.tasks.filter((x) => x.id !== id);
  db.notifications = db.notifications.filter((n) => n.taskId !== id);
  save();
  return { deleted: true };
}

// ---------------- 현황·알림 ----------------
export function summary({ from, to, role }) {
  const todayStr = today();
  const list = getDb().tasks.map((k) => decorate(k, todayStr))
    .concat(from && to ? projections(from, to, todayStr) : [])
    .filter((k) => (!from || k.dueDate >= from) && (!to || k.dueDate <= to));
  return getDb().members.filter((m) => m.active !== false).map((m) => {
    const mine = list.filter((k) => matchMember(k, m.id, role));
    const c = { 계획: 0, 예정: 0, 진행중: 0, 완료: 0, 지연: 0 };
    for (const k of mine) { c[k.status]++; if (k.overdue) c.지연++; }
    const real = c.예정 + c.진행중 + c.완료;
    return { memberId: m.id, name: m.name, ...c, total: mine.length, doneRate: real ? Math.round((c.완료 / real) * 100) : null };
  });
}

export function listNotifications(memberId) {
  return getDb().notifications.filter((n) => n.memberId === memberId).slice(-100).reverse();
}
export function readNotifications(memberId, ids) {
  const set = ids ? new Set(ids) : null;
  for (const n of getDb().notifications) if (n.memberId === memberId && (!set || set.has(n.id))) n.read = true;
  save();
  return { ok: true };
}
