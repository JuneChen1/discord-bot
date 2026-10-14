const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { buildRemindersCsv } = require('../lib/reminderCsv');
const { parseCSVLine } = require('../lib/utils');

function makeReminder(overrides = {}) {
  return {
    id: '1',
    userId: 'u1',
    eventDate: '20260101',
    eventTime: '',
    remindTime: '22:00',
    remindAt: Date.now() + 100000,
    message: '測試提醒',
    ...overrides,
  };
}

// 去掉 BOM 後切成資料列，並以匯入端同一個 parser 解析成欄位陣列
function parseCsv(csv) {
  return csv
    .replace(/^﻿/, '')
    .split(/\r?\n/)
    .filter((l) => l)
    .map(parseCSVLine);
}

describe('buildRemindersCsv', () => {
  test('開頭有 UTF-8 BOM，且 header 欄位順序與 /remind-import 相同', () => {
    const csv = buildRemindersCsv([makeReminder()]);
    assert.equal(csv.startsWith('﻿'), true);
    assert.deepEqual(parseCsv(csv)[0], [
      'date',
      'message',
      'time',
      'remind_time',
      'remind_date',
      'type',
      'remind_offset_days',
      'end_date',
      'count',
    ]);
  });

  test('沒有提醒時只輸出 header', () => {
    assert.equal(parseCsv(buildRemindersCsv([])).length, 1);
  });

  test('單次提醒輸出 date/message/time/remind_time/remind_date，週期欄位留空', () => {
    const [, row] = parseCsv(
      buildRemindersCsv([
        makeReminder({ eventTime: '14:30', remindTime: '08:00', remindDate: '20251231' }),
      ]),
    );
    assert.deepEqual(row, ['20260101', '測試提醒', '14:30', '08:00', '20251231', '', '', '', '']);
  });

  test('多筆提醒依 eventDate 升冪排序', () => {
    const rows = parseCsv(
      buildRemindersCsv([
        makeReminder({ eventDate: '20260301', message: 'B' }),
        makeReminder({ eventDate: '20260101', message: 'A' }),
      ]),
    );
    assert.deepEqual([rows[1][1], rows[2][1]], ['A', 'B']);
  });

  test('message 含逗號與雙引號時會被正確跳脫，可被 parseCSVLine 還原', () => {
    const message = '買 "牛奶", 麵包';
    const [, row] = parseCsv(buildRemindersCsv([makeReminder({ message })]));
    assert.equal(row[1], message);
  });

  test('message 含換行時以空白取代，不會拆成多列', () => {
    const rows = parseCsv(buildRemindersCsv([makeReminder({ message: '第一行\n第二行' })]));
    assert.equal(rows.length, 2);
    assert.equal(rows[1][1], '第一行 第二行');
  });

  test('以 endCount 結束的週期提醒輸出含本場的剩餘次數作為 count，end_date 留空', () => {
    const [, row] = parseCsv(
      buildRemindersCsv([
        makeReminder({
          recurrence: { type: 'weekly', occurrenceIndex: 3, endCount: 8, remindOffsetDays: 1 },
        }),
      ]),
    );
    assert.deepEqual(row.slice(4), ['', 'weekly', '1', '', '6']);
  });

  test('以 endDate 結束的週期提醒輸出 end_date，count 留空', () => {
    const [, row] = parseCsv(
      buildRemindersCsv([
        makeReminder({
          recurrence: {
            type: 'monthly',
            occurrenceIndex: 1,
            endDate: '20261231',
            endCount: null,
            remindOffsetDays: 0,
          },
        }),
      ]),
    );
    assert.deepEqual(row.slice(4), ['', 'monthly', '0', '20261231', '']);
  });

  test('缺少 eventTime/remindTime 的舊資料輸出空字串而非 undefined', () => {
    const csv = buildRemindersCsv([
      makeReminder({ eventTime: undefined, remindTime: undefined, remindDate: undefined }),
    ]);
    assert.equal(csv.includes('undefined'), false);
  });
});
