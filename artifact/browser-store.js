// 브라우저 저장소: claude.ai 아티팩트 공유 DB(db 기능)에 저장, 불가하면 이 브라우저(localStorage)에 저장
const COLLS = { members: 'members', templates: 'templates', tasks: 'tasks', notifications: 'notifications' };
const LS_KEY = 'rr.db.v1';
const EMPTY = () => ({ version: 1, members: [], templates: [], tasks: [], notifications: [] });

let db = EMPTY();
let backend = { kind: 'none' };
const lastSaved = {}; // `${coll}/${id}` -> JSON (저장소에 반영된 상태)
let flushTimer = null;
let flushing = Promise.resolve();
let onRemote = () => {};
let onStatus = () => {};

export const getDb = () => db;
export const UPLOAD_DIR = '';
export const DATA_DIR = '';
export const newId = (prefix) => {
  const a = new Uint8Array(6);
  crypto.getRandomValues(a);
  return `${prefix}_${[...a].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
};
export const nowIso = () => new Date().toISOString();
export const storageKind = () => backend.kind;
export function setHandlers({ remote, status }) { if (remote) onRemote = remote; if (status) onStatus = status; }

const stripId = (o) => JSON.parse(JSON.stringify(o));

export function save() {
  if (backend.kind === 'local') {
    try { localStorage.setItem(LS_KEY, JSON.stringify(db)); } catch { onStatus('브라우저 저장 공간에 저장하지 못했습니다.', true); }
    return;
  }
  if (backend.kind !== 'db') return;
  clearTimeout(flushTimer);
  flushTimer = setTimeout(() => { flushing = flushing.then(flush, flush); }, 250);
}

async function flush() {
  const ops = [];
  for (const [key, coll] of Object.entries(COLLS)) {
    const seen = new Set();
    for (const item of db[key]) {
      const k = `${coll}/${item.id}`;
      seen.add(k);
      const json = JSON.stringify(item);
      if (lastSaved[k] !== json) ops.push({ k, coll, id: item.id, json, body: stripId(item) });
    }
    for (const k of Object.keys(lastSaved)) {
      if (k.startsWith(`${coll}/`) && !seen.has(k)) ops.push({ k, coll, id: k.slice(coll.length + 1), del: true });
    }
  }
  if (!ops.length) return;
  onStatus('저장 중…');
  for (const op of ops) {
    try {
      const ref = backend.db.collection(op.coll).doc(op.id);
      if (op.del) { await ref.delete(); delete lastSaved[op.k]; } else { await ref.set(op.body); lastSaved[op.k] = op.json; }
    } catch (e) {
      const code = e?.code;
      onStatus(code === 'invalid_argument' ? '저장 권한이 없습니다(보기 전용).' : code === 'quota_exceeded' ? '저장 용량이 가득 찼습니다.' : '저장에 실패했습니다. 잠시 후 다시 시도해 주세요.', true);
      return;
    }
  }
  onStatus('저장됨');
}

function applyRemote(key, coll, snap) {
  const remote = new Map(snap.docs.map((d) => [d.id, d.data()]));
  const next = [];
  const local = new Map(db[key].map((x) => [x.id, x]));
  // 원격 문서 반영 (아직 저장 안 된 로컬 변경은 유지)
  for (const [id, body] of remote) {
    const k = `${coll}/${id}`;
    const l = local.get(id);
    const dirty = l && JSON.stringify(l) !== lastSaved[k];
    if (dirty) next.push(l);
    else { const copy = stripId(body); next.push(copy); lastSaved[k] = JSON.stringify(copy); }
    local.delete(id);
  }
  // 원격에 없는 로컬 항목: 새로 만든(아직 저장 전) 것만 유지
  for (const [id, l] of local) {
    if (lastSaved[`${coll}/${id}`] === undefined) next.push(l);
    else delete lastSaved[`${coll}/${id}`];
  }
  db[key] = next;
}

const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);

export async function initStore() {
  let cdb = null;
  try { cdb = await withTimeout(globalThis.claude?.use ? globalThis.claude.use('db') : Promise.resolve(null), 10000); } catch { cdb = null; }
  if (cdb) {
    try {
      for (const [key, coll] of Object.entries(COLLS)) {
        const snap = await withTimeout(cdb.collection(coll).get(), 15000);
        db[key] = snap.docs.map((d) => stripId(d.data()));
        for (const x of db[key]) lastSaved[`${coll}/${x.id}`] = JSON.stringify(x);
      }
      backend = { kind: 'db', db: cdb };
      let t = null;
      for (const [key, coll] of Object.entries(COLLS)) {
        cdb.collection(coll).onSnapshot((snap) => {
          if (snap.metadata.hasPendingWrites) return; // 내 저장 진행 중 echo는 무시
          applyRemote(key, coll, snap);
          clearTimeout(t);
          t = setTimeout(() => onRemote(), 400);
        }, () => onStatus('실시간 동기화가 끊겼습니다. 새로고침하면 다시 연결됩니다.', true));
      }
      return 'db';
    } catch {
      onStatus('공유 저장소에 연결하지 못해 이 브라우저에 저장합니다.', true);
    }
  }
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) db = { ...EMPTY(), ...JSON.parse(raw) };
    backend = { kind: 'local' };
  } catch { backend = { kind: 'none' }; }
  return backend.kind;
}
