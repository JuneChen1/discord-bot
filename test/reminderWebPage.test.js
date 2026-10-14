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

  test('提供 csvHref 且有提醒時，標題右側顯示下載按鈕', () => {
    const html = renderRemindersPage([makeReminder()], 'june', '/reminders.csv?token=abc');
    assert.equal(html.includes('href="/reminders.csv?token=abc"'), true);
    assert.equal(html.includes('下載 CSV'), true);
    // 按鈕與標題同在 page-header 內，且排在標題之後
    const header = html.slice(html.indexOf('class="page-header"'), html.indexOf('<ul>'));
    assert.ok(header.indexOf('<h1>') < header.indexOf('class="download"'));
  });

  test('csvHref 會被 HTML escape，避免破壞屬性', () => {
    const html = renderRemindersPage([makeReminder()], 'june', '/x?a="><script>alert(1)</script>');
    assert.equal(html.includes('<script>alert(1)</script>'), false);
  });

  test('未提供 csvHref 或清單為空時不顯示下載按鈕', () => {
    assert.equal(renderRemindersPage([makeReminder()], 'june').includes('下載 CSV'), false);
    assert.equal(renderRemindersPage([], 'june', '/reminders.csv?token=abc').includes('下載 CSV'), false);
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
