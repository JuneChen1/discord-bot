const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const {
  DEFAULT_REMIND_HOUR,
  DEFAULT_REMIND_MINUTE,
  toMinutes,
  formatEventDate,
  formatTaipeiTime,
  parseCSVLine,
  parseRemindTime,
  calcReminderTime,
  isDuplicateReminder,
  applyReminderEdits,
} = require('./utils');

// ── applyReminderEdits ────────────────────────────────────

describe('applyReminderEdits', () => {
  const EXISTING = {
    eventDate: '20260510',
    message: '會議',
    eventTime: '14:30',
    remindDate: '20260509',
    remindTime: '22:00',
  };

  test('無 patches → 全部保留 existing', () => {
    assert.deepEqual(applyReminderEdits(EXISTING, {}), {
      dateStr: '20260510',
      message: '會議',
      timeStr: '14:30',
      remindDateStr: '20260509',
      remindTimeRaw: '22:00',
    });
  });

  test('只改 message', () => {
    const result = applyReminderEdits(EXISTING, { message: '新主題' });
    assert.equal(result.message, '新主題');
    assert.equal(result.dateStr, '20260510');
    assert.equal(result.timeStr, '14:30');
    assert.equal(result.remindDateStr, '20260509');
    assert.equal(result.remindTimeRaw, '22:00');
  });

  test('只改 date', () => {
    const result = applyReminderEdits(EXISTING, { date: '20260601' });
    assert.equal(result.dateStr, '20260601');
    assert.equal(result.message, '會議');
  });

  test('只改 time', () => {
    const result = applyReminderEdits(EXISTING, { time: '16:00' });
    assert.equal(result.timeStr, '16:00');
    assert.equal(result.dateStr, '20260510');
  });

  test('只改 remindDate', () => {
    const result = applyReminderEdits(EXISTING, { remindDate: '20260508' });
    assert.equal(result.remindDateStr, '20260508');
    assert.equal(result.remindTimeRaw, '22:00');
  });

  test('只改 remindTime', () => {
    const result = applyReminderEdits(EXISTING, { remindTime: '09:00' });
    assert.equal(result.remindTimeRaw, '09:00');
    assert.equal(result.remindDateStr, '20260509');
  });

  test('同時改多個欄位', () => {
    const result = applyReminderEdits(EXISTING, { message: '新主題', date: '20260601', remindTime: '08:00' });
    assert.equal(result.message, '新主題');
    assert.equal(result.dateStr, '20260601');
    assert.equal(result.remindTimeRaw, '08:00');
    assert.equal(result.timeStr, '14:30');
    assert.equal(result.remindDateStr, '20260509');
  });

  test('existing 沒有 remindDate → remindDateStr 預設為空字串', () => {
    const withoutRemindDate = { ...EXISTING };
    delete withoutRemindDate.remindDate;
    const result = applyReminderEdits(withoutRemindDate, {});
    assert.equal(result.remindDateStr, '');
  });

  test('patch remindDate 為空字串（清除提醒日期）', () => {
    const result = applyReminderEdits(EXISTING, { remindDate: '' });
    assert.equal(result.remindDateStr, '');
  });

  test('patch time 為空字串（清除事件時間）', () => {
    const result = applyReminderEdits(EXISTING, { time: '' });
    assert.equal(result.timeStr, '');
  });
});

// ── isDuplicateReminder ───────────────────────────────────

describe('isDuplicateReminder', () => {
  const BASE = { userId: 'u1', eventDate: '20260510', eventTime: '14:30', message: '會議', remindTime: '22:00', remindDate: '' };
  const makeReminder = (overrides = {}) => ({ ...BASE, ...overrides });
  const BASE_OPTS = { userId: 'u1', eventDate: '20260510', eventTime: '14:30', message: '會議', remindTime: '22:00', remindDate: '' };

  test('完全相同 → true', () => {
    assert.equal(isDuplicateReminder([makeReminder()], BASE_OPTS), true);
  });
  test('空列表 → false', () => {
    assert.equal(isDuplicateReminder([], BASE_OPTS), false);
  });
  test('不同使用者 → false', () => {
    assert.equal(isDuplicateReminder([makeReminder()], { ...BASE_OPTS, userId: 'u2' }), false);
  });
  test('不同 eventDate → false', () => {
    assert.equal(isDuplicateReminder([makeReminder()], { ...BASE_OPTS, eventDate: '20260511' }), false);
  });
  test('不同 eventTime → false', () => {
    assert.equal(isDuplicateReminder([makeReminder()], { ...BASE_OPTS, eventTime: '15:00' }), false);
  });
  test('不同 message → false', () => {
    assert.equal(isDuplicateReminder([makeReminder()], { ...BASE_OPTS, message: '其他' }), false);
  });
  test('不同 remindTime → false', () => {
    assert.equal(isDuplicateReminder([makeReminder()], { ...BASE_OPTS, remindTime: '21:00' }), false);
  });
  test('有 remindDate 且相同 → true', () => {
    assert.equal(isDuplicateReminder([makeReminder({ remindDate: '20260509' })], { ...BASE_OPTS, remindDate: '20260509' }), true);
  });
  test('有 remindDate 但不同 → false', () => {
    assert.equal(isDuplicateReminder([makeReminder({ remindDate: '20260509' })], { ...BASE_OPTS, remindDate: '20260508' }), false);
  });
});

// ── toMinutes ─────────────────────────────────────────────

describe('toMinutes', () => {
  test('一般時間 14:30 → 870', () => {
    assert.equal(toMinutes('14:30'), 870);
  });
  test('午夜 00:00 → 0', () => {
    assert.equal(toMinutes('00:00'), 0);
  });
  test('23:59 → 1439', () => {
    assert.equal(toMinutes('23:59'), 1439);
  });
  test('前導零 08:05 → 485', () => {
    assert.equal(toMinutes('08:05'), 485);
  });
  test('格式不合 → NaN', () => {
    assert.ok(isNaN(toMinutes('invalid')));
  });
});

// ── formatEventDate ───────────────────────────────────────

describe('formatEventDate', () => {
  test('正常日期 20260510 → 2026/05/10', () => {
    assert.equal(formatEventDate('20260510'), '2026/05/10');
  });
  test('年底日期 20231231 → 2023/12/31', () => {
    assert.equal(formatEventDate('20231231'), '2023/12/31');
  });
  test('月初 20260101 → 2026/01/01', () => {
    assert.equal(formatEventDate('20260101'), '2026/01/01');
  });
});

// ── formatTaipeiTime ──────────────────────────────────────

describe('formatTaipeiTime', () => {
  test('UTC+8 偏移正確：14:00 UTC → 22:00 台灣', () => {
    const ts = Date.UTC(2026, 4, 10, 14, 0, 0, 0);
    assert.equal(formatTaipeiTime(ts), '2026/05/10 22:00');
  });
  test('跨日邊界：16:30 UTC → 隔天 00:30 台灣', () => {
    const ts = Date.UTC(2026, 4, 10, 16, 30, 0, 0);
    assert.equal(formatTaipeiTime(ts), '2026/05/11 00:30');
  });
  test('前導零補足：00:05 UTC → 08:05 台灣', () => {
    const ts = Date.UTC(2026, 0, 5, 0, 5, 0, 0);
    assert.equal(formatTaipeiTime(ts), '2026/01/05 08:05');
  });
  test('跨月：4/30 16:00 UTC → 5/1 00:00 台灣', () => {
    const ts = Date.UTC(2026, 3, 30, 16, 0, 0, 0);
    assert.equal(formatTaipeiTime(ts), '2026/05/01 00:00');
  });
});

// ── parseCSVLine ──────────────────────────────────────────

describe('parseCSVLine', () => {
  test('基本三欄', () => {
    assert.deepEqual(
      parseCSVLine('20260510,hello,14:30'),
      ['20260510', 'hello', '14:30']
    );
  });
  test('帶引號欄位（含逗號）', () => {
    assert.deepEqual(
      parseCSVLine('20260510,"hello, world",14:30'),
      ['20260510', 'hello, world', '14:30']
    );
  });
  test('尾端空欄位', () => {
    assert.deepEqual(
      parseCSVLine('20260510,hello,,'),
      ['20260510', 'hello', '', '']
    );
  });
  test('全空欄位', () => {
    assert.deepEqual(parseCSVLine(','), ['', '']);
  });
  test('引號包圍但無逗號', () => {
    assert.deepEqual(
      parseCSVLine('"20260510","hello"'),
      ['20260510', 'hello']
    );
  });
  test('五欄完整格式', () => {
    assert.deepEqual(
      parseCSVLine('20260510,會議,14:30,21:00,20260509'),
      ['20260510', '會議', '14:30', '21:00', '20260509']
    );
  });
  test('引號內 "" 跳脫為單一引號字元', () => {
    assert.deepEqual(
      parseCSVLine('20260510,"say ""hi""",14:30'),
      ['20260510', 'say "hi"', '14:30']
    );
  });
  test('引號未關閉 → null', () => {
    assert.equal(parseCSVLine('20260510,"未關閉'), null);
  });
});

// ── parseRemindTime ───────────────────────────────────────

describe('parseRemindTime', () => {
  test('null → 預設 22:00', () => {
    assert.deepEqual(parseRemindTime(null), { hour: DEFAULT_REMIND_HOUR, minute: DEFAULT_REMIND_MINUTE });
  });
  test('空字串 → 預設 22:00', () => {
    assert.deepEqual(parseRemindTime(''), { hour: DEFAULT_REMIND_HOUR, minute: DEFAULT_REMIND_MINUTE });
  });
  test('正常 HH:MM', () => {
    assert.deepEqual(parseRemindTime('18:30'), { hour: 18, minute: 30 });
  });
  test('單位數小時', () => {
    assert.deepEqual(parseRemindTime('9:05'), { hour: 9, minute: 5 });
  });
  test('午夜 00:00', () => {
    assert.deepEqual(parseRemindTime('00:00'), { hour: 0, minute: 0 });
  });
  test('最大值 23:59', () => {
    assert.deepEqual(parseRemindTime('23:59'), { hour: 23, minute: 59 });
  });
  test('格式錯誤文字 → null', () => {
    assert.equal(parseRemindTime('invalid'), null);
  });
  test('小時超過 23 → null', () => {
    assert.equal(parseRemindTime('25:00'), null);
  });
  test('分鐘超過 59 → null', () => {
    assert.equal(parseRemindTime('10:60'), null);
  });
  test('缺少冒號 → null', () => {
    assert.equal(parseRemindTime('1430'), null);
  });
  test('多餘字元 → null', () => {
    assert.equal(parseRemindTime('14:30:00'), null);
  });
});

// ── calcReminderTime ──────────────────────────────────────

describe('calcReminderTime', () => {
  test('預設：事件前一天 22:00 台灣時間（= 14:00 UTC）', () => {
    const ts = calcReminderTime('20260510');
    assert.equal(ts, Date.UTC(2026, 4, 9, 14, 0, 0, 0));
  });
  test('自訂提醒時間 09:00 台灣（= 01:00 UTC）', () => {
    const ts = calcReminderTime('20260510', 9, 0);
    assert.equal(ts, Date.UTC(2026, 4, 9, 1, 0, 0, 0));
  });
  test('指定 remindDateStr，不取前一天', () => {
    const ts = calcReminderTime('20260510', 22, 0, '20260508');
    assert.equal(ts, Date.UTC(2026, 4, 8, 14, 0, 0, 0));
  });
  test('remindDateStr 與事件同日', () => {
    const ts = calcReminderTime('20260510', 8, 0, '20260510');
    assert.equal(ts, Date.UTC(2026, 4, 10, 0, 0, 0, 0));
  });
  test('跨月：月初事件，前一天為上月底', () => {
    const ts = calcReminderTime('20260601');
    assert.equal(ts, Date.UTC(2026, 4, 31, 14, 0, 0, 0));
  });
  test('跨年：元旦事件，前一天為上一年底', () => {
    const ts = calcReminderTime('20270101');
    assert.equal(ts, Date.UTC(2026, 11, 31, 14, 0, 0, 0));
  });
  test('非 8 位數 eventDateStr → null', () => {
    assert.equal(calcReminderTime('2026051'), null);
  });
  test('含非數字的 eventDateStr → null', () => {
    assert.equal(calcReminderTime('2026ABCD'), null);
  });
  test('非 8 位數 remindDateStr → null', () => {
    assert.equal(calcReminderTime('20260510', 22, 0, '202605'), null);
  });
  test('提醒分鐘數正確對應 UTC', () => {
    const ts = calcReminderTime('20260510', 22, 30);
    assert.equal(ts, Date.UTC(2026, 4, 9, 14, 30, 0, 0));
  });
  test('remindHour < 8 隱式往前一天：台灣 02:00 = 前一天 18:00 UTC', () => {
    const ts = calcReminderTime('20260510', 2, 0);
    assert.equal(ts, Date.UTC(2026, 4, 8, 18, 0, 0, 0));
  });
});
