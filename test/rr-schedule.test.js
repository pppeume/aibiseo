import test from 'node:test';
import assert from 'node:assert/strict';
import { addMonths, occurrences, suggestSchedule, monthsFromNote, describeSchedule } from '../rr/schedule.js';

test('월 이동: 일자 유지 및 말일 보정', () => {
  assert.equal(addMonths('2026-01-15', 1), '2026-02-15');
  assert.equal(addMonths('2026-01-31', 1), '2026-02-28');
  assert.equal(addMonths('2026-11-30', 1), '2026-12-31'); // 말일 기준 → 말일
  assert.equal(addMonths('2026-11-30', 3), '2027-02-28');
  assert.equal(addMonths('2026-12-29', 2), '2027-02-28');
  assert.equal(addMonths('2026-12-29', 3), '2027-03-29'); // 말일 아님 → 일자 유지(누적 오차 없음)
});

test('반복 발생일: 일/주/월/분기/년', () => {
  assert.deepEqual(occurrences({ unit: 'day', interval: 1, startDate: '2026-11-06', skipWeekends: true }, '2026-11-06', '2026-11-10'),
    ['2026-11-06', '2026-11-09', '2026-11-10']);
  assert.deepEqual(occurrences({ unit: 'week', interval: 2, startDate: '2026-11-02' }, '2026-11-10', '2026-12-10'),
    ['2026-11-16', '2026-11-30']);
  assert.deepEqual(occurrences({ unit: 'quarter', interval: 1, startDate: '2026-12-31' }, '2026-01-01', '2027-12-31'),
    ['2026-12-31', '2027-03-31', '2027-06-30', '2027-09-30', '2027-12-31']);
  assert.deepEqual(occurrences({ unit: 'quarter', interval: 2, startDate: '2026-06-30' }, '2026-01-01', '2027-12-31'),
    ['2026-06-30', '2026-12-31', '2027-06-30', '2027-12-31']);
  assert.deepEqual(occurrences({ unit: 'year', interval: 1, startDate: '2026-11-30', endDate: '2028-01-01' }, '2026-01-01', '2030-01-01'),
    ['2026-11-30', '2027-11-30']);
});

test('비고의 실행월 해석 및 기준일 제안', () => {
  assert.deepEqual(monthsFromNote('실행월: 3,6,9,12월'), [3, 6, 9, 12]);
  assert.deepEqual(monthsFromNote('8월~9월'), [8, 9]);
  assert.deepEqual(monthsFromNote('자동화 구현 이후'), []);
  assert.deepEqual(monthsFromNote('만료 3개월 전 착수'), []);
  assert.equal(suggestSchedule('매년', '실행월: 11월', '2026-11-09').startDate, '2026-11-30');
  assert.equal(suggestSchedule('매년', '8월~9월', '2026-11-09').startDate, '2027-08-31');
  assert.equal(suggestSchedule('매분기', '', '2026-11-09').startDate, '2026-12-31');
  assert.equal(suggestSchedule('매주', '', '2026-11-11').startDate, '2026-11-09'); // 이번 주 월요일
  assert.equal(describeSchedule({ cycleType: '매반기', schedule: { unit: 'quarter', interval: 2, startDate: '2026-12-31' } }), '2분기마다 · 기준일 2026-12-31');
});

test('날짜 형식 검증', async () => {
  const { isDate } = await import('../rr/schedule.js');
  assert.equal(isDate('2026-11-09'), true);
  assert.equal(isDate('2026-13-01'), false);
  assert.equal(isDate('2026-02-30'), false);
  assert.equal(isDate('2026-1-1'), false);
});
