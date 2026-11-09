// /api/rr 라우터
import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { UPLOAD_DIR, newId } from './store.js';
import { parseRnR } from './importer.js';
import { CYCLE_TYPES, UNITS, UNIT_LABEL, CYCLE_DEFAULTS, today, occurrences, suggestSchedule, isDate } from './schedule.js';
import * as svc from './service.js';

const router = express.Router();

const MAX_FILE_MB = Number(process.env.RR_MAX_FILE_MB || 20);
const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (_req, file, cb) => cb(null, `${newId('u')}${path.extname(file.originalname).slice(0, 10).replace(/[^.\w]/g, '')}`),
  }),
  limits: { fileSize: MAX_FILE_MB * 1024 * 1024, files: 10 },
});
const excelUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 1 } });

// 요청자(현재 사용자) – 로그인 기능이 없으므로 화면에서 선택한 담당자 ID를 헤더로 받는다
const actor = (req) => {
  const id = req.get('x-rr-member') || '';
  return svc.listMembers().some((m) => m.id === id) ? id : null;
};
const wrap = (fn) => async (req, res) => {
  try {
    res.json(await fn(req, res));
  } catch (e) {
    const status = e.status || 500;
    if (status === 500) console.error('[RR]', e);
    res.status(status).json({ error: e.message || '서버 오류' });
  }
};

router.get('/meta', wrap(() => ({
  today: today(), cycleTypes: CYCLE_TYPES, units: UNITS, unitLabel: UNIT_LABEL, cycleDefaults: CYCLE_DEFAULTS,
  statuses: svc.ALL_STATUSES, maxFileMb: MAX_FILE_MB,
})));

// 담당자
router.get('/members', wrap(() => svc.listMembers()));
router.post('/members', wrap((req) => svc.addMember(req.body || {})));
router.put('/members/:id', wrap((req) => svc.updateMember(req.params.id, req.body || {})));
router.delete('/members/:id', wrap((req) => svc.deleteMember(req.params.id)));

// 업무 표준
router.get('/templates', wrap(() => svc.listTemplates()));
router.post('/templates', wrap((req) => svc.createTemplate(req.body || {})));
router.put('/templates/:id', wrap((req) => svc.updateTemplate(req.params.id, req.body || {})));
router.delete('/templates/:id', wrap((req) => svc.deleteTemplate(req.params.id)));
router.post('/templates/bulk-active', wrap((req) => svc.setTemplatesActive(req.body?.ids, req.body?.active)));
router.post('/templates/:id/occur', wrap((req) => svc.occurTask(req.params.id, req.body || {}, actor(req))));
router.post('/schedule/preview', wrap((req) => {
  const s = req.body || {};
  const from = isDate(s.startDate) ? s.startDate : today();
  return { dates: occurrences({ ...s, interval: Number(s.interval) }, from, '9999-12-31', 6) };
}));
router.get('/schedule/suggest', wrap((req) => suggestSchedule(req.query.cycleType, req.query.note)));

// 엑셀 가져오기
router.post('/import', excelUpload.single('file'), wrap(async (req) => {
  if (!req.file) throw new svc.HttpError(400, '엑셀 파일을 선택해 주세요.');
  const parsed = await parseRnR(req.file.buffer).catch((e) => { throw new svc.HttpError(400, e.message); });
  const result = svc.importParsed(parsed);
  svc.generate();
  return result;
}));

// 업무 생성(수동 실행)
router.post('/generate', wrap(() => svc.generate()));

// 업무
router.get('/tasks', wrap((req) => svc.queryTasks({ ...req.query, includePlanned: req.query.includePlanned === '1' })));
router.get('/tasks/:id', wrap((req) => svc.getTask(req.params.id)));
router.put('/tasks/:id', wrap((req) => svc.updateTask(req.params.id, req.body || {}, actor(req))));
router.delete('/tasks/:id', wrap((req) => svc.deleteTask(req.params.id)));
router.post('/tasks/:id/logs', wrap((req) => svc.addLog(req.params.id, req.body || {}, actor(req))));
router.post('/tasks/:id/files', (req, res, next) => upload.array('files', 10)(req, res, (err) => {
  if (err) {
    const msg = err.code === 'LIMIT_FILE_SIZE' ? `파일은 ${MAX_FILE_MB}MB 이하만 올릴 수 있습니다.` : err.message;
    return res.status(400).json({ error: msg });
  }
  next();
}), wrap((req) => {
  try {
    return svc.addFiles(req.params.id, req.files || [], actor(req));
  } catch (e) {
    for (const f of req.files || []) fs.rmSync(f.path, { force: true }); // 업무가 없으면 업로드 파일 정리
    throw e;
  }
}));
router.delete('/tasks/:id/files/:fileId', wrap((req) => svc.deleteFile(req.params.id, req.params.fileId)));
router.get('/files/:fileId', (req, res) => {
  try {
    const f = svc.getFile(req.params.fileId);
    if (!fs.existsSync(f.path)) return res.status(404).json({ error: '파일이 저장소에 없습니다.' });
    res.download(f.path, f.name);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

// 달력·현황·알림
router.get('/calendar', wrap((req) => {
  const { from, to, member, role } = req.query;
  if (!isDate(from) || !isDate(to)) throw new svc.HttpError(400, 'from/to 날짜가 필요합니다.');
  return svc.queryTasks({ from, to, member, role, includePlanned: true });
}));
router.get('/summary', wrap((req) => svc.summary(req.query)));
router.get('/notifications', wrap((req) => svc.listNotifications(String(req.query.member || ''))));
router.post('/notifications/read', wrap((req) => svc.readNotifications(String(req.body?.member || ''), req.body?.ids)));

export default router;

// 서버 기동 시 1회 + 1시간마다 주기 업무 생성 (날짜가 바뀌면 새 회차가 만들어진다)
export function startScheduler() {
  const run = () => {
    try {
      const r = svc.generate();
      if (r.created) console.log(`[RR] ${r.date} 주기 업무 ${r.created}건 생성`);
    } catch (e) {
      console.error('[RR] 주기 업무 생성 실패:', e);
    }
  };
  run();
  return setInterval(run, 60 * 60 * 1000);
}
