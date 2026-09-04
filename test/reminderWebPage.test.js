const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { renderRemindersPage } = require('../lib/reminderWebPage');

function makeReminder(overrides = {}) {
  return {
    id: '1',
    userId: 'u1',
    eventDate: '20260101',
    remindAt: Date.now() + 100000,
    message: '測試提醒',
    ...overrides,
  };
}

describe('renderRemindersPage', () => {
  test('提醒內容含 HTML/Script 標籤時會被 escape，不會被當成標籤解析', () => {
    const html = renderRemindersPage([
      makeReminder({ message: '<script>alert(1)</script>' }),
    ]);
    assert.equal(html.includes('<script>alert(1)</script>'), false);
    assert.equal(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'), true);
  });

  test('userName 含特殊字元時會被 escape', () => {
    const html = renderRemindersPage([makeReminder()], '<b>june</b>');
    assert.equal(html.includes('<b>june</b> 的提醒清單'), false);
    assert.equal(html.includes('&lt;b&gt;june&lt;/b&gt; 的提醒清單'), true);
  });

  test('未提供 userName 時標題退回「我的提醒清單」', () => {
    const html = renderRemindersPage([makeReminder()]);
    assert.equal(html.includes('我的提醒清單'), true);
  });

  test('沒有任何提醒時顯示空清單訊息', () => {
    const html = renderRemindersPage([]);
    assert.equal(html.includes('目前沒有任何待發送的提醒'), true);
  });

  test('多筆提醒依 eventDate 升冪排序', () => {
    const html = renderRemindersPage([
      makeReminder({ id: 'b', eventDate: '20260301', message: 'B提醒' }),
      makeReminder({ id: 'a', eventDate: '20260101', message: 'A提醒' }),
    ]);
    assert.ok(html.indexOf('A提醒') < html.indexOf('B提醒'));
  });

  test('週期提醒會顯示週期標示與剩餘次數', () => {
    const html = renderRemindersPage([
      makeReminder({
        recurrence: { type: 'weekly', occurrenceIndex: 1, endCount: 3, remindOffsetDays: 1 },
      }),
    ]);
    assert.equal(html.includes('🔁'), true);
    assert.equal(html.includes('還剩3次'), true);
  });
});
