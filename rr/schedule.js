// 날짜·주기 계산 유틸 (모든 날짜는 'YYYY-MM-DD' 문자열, 내부 계산은 UTC 기준)

export const CYCLE_TYPES = ['발생시', '매일', '매주', '매월', '매분기', '매반기', '매년'];
export const UNITS = ['day', 'week', 'month', 'quarter', 'year'];
export const UNIT_LABEL = { day: '일', week: '주', month: '월', quarter: '분기', year: '년' };

// 업무 구분별 기본 주기 (반기 = 분기 × 2)
export const CYCLE_DEFAULTS = {
  매일: { unit: 'day', interval: 1, leadDays: 0, skipWeekends: true },
  매주: { unit: 'week', interval: 1, leadDays: 3, skipWeekends: false },
  매월: { unit: 'month', interval: 1, leadDays: 7, skipWeekends: false },
  매분기: { unit: 'quarter', interval: 1, leadDays: 14, skipWeekends: false },
  매반기: { unit: 'quarter', interval: 2, leadDays: 14, skipWeekends: false },
  매년: { unit: 'year', interval: 1, leadDays: 30, skipWeekends: false },
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const isDate = (s) => typeof s === 'string' && DATE_RE.test(s) && fmt(parse(s)) === s; // 2026-13-01 같은 값 거부

function parse(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}
function fmt(dt) {
  return dt.toISOString().slice(0, 10);
}

export function today(tz = process.env.RR_TZ || 'Asia/Seoul') {
  // en-CA 로케일은 YYYY-MM-DD 형식을 반환
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date());
}

export function addDays(s, n) {
  const dt = parse(s);
  dt.setUTCDate(dt.getUTCDate() + n);
  return fmt(dt);
}

const daysInMonth = (y, m0) => new Date(Date.UTC(y, m0 + 1, 0)).getUTCDate();

// 기준일의 '일'을 유지하며 n개월 이동 (해당 월에 그 날이 없으면 말일로 보정)
// 기준일이 그 달의 말일이면 매 회차도 말일로 맞춘다 (예: 11-30 → 12-31 → 01-31 → 02-28)
export function addMonths(s, n) {
  const [y, m, d] = s.split('-').map(Number);
  const total = y * 12 + (m - 1) + n;
  const ny = Math.floor(total / 12);
  const nm0 = total - ny * 12;
  const monthEnd = d === daysInMonth(y, m - 1);
  const nd = monthEnd ? daysInMonth(ny, nm0) : Math.min(d, daysInMonth(ny, nm0));
  return fmt(new Date(Date.UTC(ny, nm0, nd)));
}

export function addPeriod(s, unit, n) {
  switch (unit) {
    case 'day': return addDays(s, n);
    case 'week': return addDays(s, 7 * n);
    case 'month': return addMonths(s, n);
    case 'quarter': return addMonths(s, 3 * n);
    case 'year': return addMonths(s, 12 * n);
    default: throw new Error(`알 수 없는 주기 단위: ${unit}`);
  }
}

export const weekday = (s) => parse(s).getUTCDay(); // 0=일 ... 6=토
export const isWeekend = (s) => [0, 6].includes(weekday(s));

/**
 * 반복 일정의 발생일 목록 (from ≤ 발생일 ≤ to)
 * schedule: { unit, interval, startDate, endDate?, skipWeekends? }
 * 매 회차는 기준일에서 직접 계산하므로 월말 보정 오차가 누적되지 않는다.
 */
export function occurrences(schedule, from, to, max = 5000) {
  const { unit, interval = 1, startDate, endDate, skipWeekends } = schedule || {};
  if (!UNITS.includes(unit) || !isDate(startDate) || !(interval >= 1)) return [];
  const out = [];
  const last = endDate && isDate(endDate) && endDate < to ? endDate : to;
  // day/week 단위는 시작 회차를 바로 계산해 불필요한 반복을 줄인다
  let k = 0;
  if ((unit === 'day' || unit === 'week') && from > startDate) {
    const span = (parse(from) - parse(startDate)) / 86400000;
    const step = (unit === 'day' ? 1 : 7) * interval;
    k = Math.max(0, Math.floor(span / step) - 1);
  }
  for (let i = 0; i < max; i++, k++) {
    const d = addPeriod(startDate, unit, k * interval);
    if (d > last) break;
    if (d < from) continue;
    if (skipWeekends && unit === 'day' && isWeekend(d)) continue;
    out.push(d);
  }
  return out;
}

export function describeSchedule(t) {
  if (t.cycleType === '발생시' || !t.schedule) return '발생 시';
  const s = t.schedule;
  const label = UNIT_LABEL[s.unit] || s.unit;
  const base = s.interval > 1 ? `${s.interval}${label}마다` : `매${label}`;
  return `${base} · 기준일 ${s.startDate}${s.skipWeekends && s.unit === 'day' ? ' · 주말 제외' : ''}`;
}

// ---- 엑셀 가져오기 시 기준일 '제안값' 계산 (확정 전 검토용) ----

const endOfMonth = (y, m1) => fmt(new Date(Date.UTC(y, m1, 0)));

// 비고에서 첫 번째 '실행월' 숫자 추출: "실행월: 3,6,9,12월" → [3,6,9,12], "8월~9월" → [8,9]
export function monthsFromNote(note) {
  if (!note) return [];
  // '월' 또는 구분자(, ~)가 뒤따르는 숫자만 추출 ("3개월" 같은 기간 표현은 제외)
  const nums = [...String(note).matchAll(/(\d{1,2})(?=\s*(?:월|,|~))/g)].map((m) => Number(m[1]));
  return nums.filter((x) => x >= 1 && x <= 12);
}

export function suggestSchedule(cycleType, note, todayStr = today()) {
  const def = CYCLE_DEFAULTS[cycleType];
  if (!def) return null;
  const [y, m] = todayStr.split('-').map(Number);
  let startDate = todayStr;
  const months = monthsFromNote(note);
  const nextMonthEnd = (cands) => {
    // 오늘 이후 가장 가까운 후보 월의 말일
    for (let add = 0; add < 24; add++) {
      const total = y * 12 + (m - 1) + add;
      const yy = Math.floor(total / 12);
      const mm = total - yy * 12 + 1;
      if (cands.includes(mm)) {
        const d = endOfMonth(yy, mm);
        if (d >= todayStr) return d;
      }
    }
    return endOfMonth(y, m);
  };
  switch (def.unit) {
    case 'day':
      startDate = todayStr;
      break;
    case 'week': {
      const wd = weekday(todayStr); // 이번 주 월요일
      startDate = addDays(todayStr, wd === 0 ? -6 : 1 - wd);
      break;
    }
    case 'month':
      startDate = endOfMonth(y, m);
      break;
    case 'quarter':
      startDate = nextMonthEnd(months.length ? months : def.interval === 2 ? [6, 12] : [3, 6, 9, 12]);
      break;
    case 'year':
      startDate = nextMonthEnd(months.length ? [months[0]] : [12]);
      break;
    default:
      break;
  }
  return { ...def, startDate, endDate: '' };
}
