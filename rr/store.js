// JSON 파일 기반 저장소 (단일 프로세스·소규모 팀 사용 전제)
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DATA_DIR = path.resolve(ROOT, process.env.RR_DATA_DIR || 'data');
export const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const DB_FILE = path.join(DATA_DIR, 'rr-db.json');

const EMPTY = () => ({ version: 1, members: [], templates: [], tasks: [], notifications: [] });

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

let db = EMPTY();
if (fs.existsSync(DB_FILE)) {
  try {
    db = { ...EMPTY(), ...JSON.parse(fs.readFileSync(DB_FILE, 'utf8')) };
  } catch (e) {
    // 손상된 파일은 덮어쓰지 않고 백업해 둔다
    const bak = `${DB_FILE}.broken-${Date.now()}`;
    fs.copyFileSync(DB_FILE, bak);
    console.error(`[RR] 데이터 파일을 읽지 못해 ${bak} 로 백업 후 빈 DB로 시작합니다:`, e.message);
  }
}

export const getDb = () => db;

export function save() {
  const tmp = `${DB_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DB_FILE);
}

export const newId = (prefix) => `${prefix}_${crypto.randomBytes(6).toString('hex')}`;
export const nowIso = () => new Date().toISOString();
