const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { errorMessages } = require('../errorHandle');

// ── 靜態訊息 ───────────────────────────────────────────────

describe('errorMessages：靜態文字', () => {
  const staticKeys = [
    'unexpectedError',
    'timeAndResetConflict',
    'invalidTimeFormat',
    'invalidDateRangeFormat',
    'invalidDateRangeOrder',
    'noEditFieldsProvided',
    'notOwnerEdit',
    'invalidCsvFile',
    'csvReadFailed',
    'csvEmpty',
    'csvHeaderOnly',
    'invalidRemindTimeFormat',
    'invalidRemindDateFormat',
    'invalidEventDateFormat',
  ];

  for (const key of staticKeys) {
    test(`${key} 為非空字串，且以 ❌ 開頭`, () => {
      assert.equal(typeof errorMessages[key], 'string');
      assert.ok(errorMessages[key].length > 0);
      assert.ok(errorMessages[key].startsWith('❌'));
    });
  }
});

// ── 帶參數的訊息函式 ───────────────────────────────────────

describe('errorMessages：duplicateReminder', () => {
  test('帶事件時間', () => {
    const msg = errorMessages.duplicateReminder('2026/05/10', '14:30', '會議');
    assert.equal(msg, '❌ 你在 `2026/05/10 14:30` 已有相同內容的提醒：「會議」');
  });
  test('不帶事件時間', () => {
    const msg = errorMessages.duplicateReminder('2026/05/10', '', '會議');
    assert.equal(msg, '❌ 你在 `2026/05/10` 已有相同內容的提醒：「會議」');
  });
});

describe('errorMessages：reminderNotFound / reminderNotFoundForDelete / notOwnerDelete', () => {
  test('reminderNotFound 包含 targetId', () => {
    assert.equal(errorMessages.reminderNotFound('abc123'), '❌ 找不到 ID 為 `abc123` 的提醒。');
  });
  test('reminderNotFoundForDelete 包含 targetId', () => {
    assert.equal(
      errorMessages.reminderNotFoundForDelete('abc123'),
      '`abc123`：找不到此 ID，多個 ID 請用空白隔開',
    );
  });
  test('notOwnerDelete 包含 targetId', () => {
    assert.equal(errorMessages.notOwnerDelete('abc123'), '`abc123`：你只能刪除自己的提醒');
  });
});

describe('errorMessages：remindDateAfterEventDate 與 CSV 對應版本文字一致', () => {
  test('標準回覆版本（❌ 開頭、！結尾）', () => {
    assert.equal(
      errorMessages.remindDateAfterEventDate('2026/05/11', '2026/05/10'),
      '❌ 提醒日期（`2026/05/11`）不能晚於事件日期（`2026/05/10`）！',
    );
  });
  test('CSV 逐行版本（第 N 行：開頭）', () => {
    assert.equal(
      errorMessages.csvLineRemindDateAfterEventDate(5, '2026/05/11', '2026/05/10'),
      '第 5 行：提醒日期（`2026/05/11`）不能晚於事件日期（`2026/05/10`）',
    );
  });
  test('兩版本核心句子相同', () => {
    const standard = errorMessages.remindDateAfterEventDate('2026/05/11', '2026/05/10');
    const csvLine = errorMessages.csvLineRemindDateAfterEventDate(5, '2026/05/11', '2026/05/10');
    const core = '提醒日期（`2026/05/11`）不能晚於事件日期（`2026/05/10`）';
    assert.ok(standard.includes(core));
    assert.ok(csvLine.includes(core));
  });
});

describe('errorMessages：remindTimeAfterEventTimeSameDay 與 CSV 對應版本文字一致', () => {
  test('標準回覆版本（❌ 開頭、！結尾）', () => {
    assert.equal(
      errorMessages.remindTimeAfterEventTimeSameDay('2026/05/10', '09:00', '08:00'),
      '❌ 提醒日期與事件同天（`2026/05/10`），提醒時間（`09:00`）不能晚於或等於事件時間（`08:00`）！',
    );
  });
  test('CSV 逐行版本（第 N 行：開頭）', () => {
    assert.equal(
      errorMessages.csvLineRemindTimeAfterEventTime(7, '2026/05/10', '09:00', '08:00'),
      '第 7 行：提醒日期與事件同天（`2026/05/10`），提醒時間（`09:00`）不能晚於或等於事件時間（`08:00`）',
    );
  });
});

describe('errorMessages：remindTimeExpired', () => {
  test('包含傳入的顯示時間字串', () => {
    assert.equal(
      errorMessages.remindTimeExpired('2026/05/10 22:00'),
      '❌ 提醒時間 2026/05/10 22:00 已過，無法設定提醒！請調整事件日期或提醒時間。',
    );
  });
});

describe('errorMessages：CSV 逐行訊息', () => {
  test('csvLineQuoteError', () => {
    assert.equal(errorMessages.csvLineQuoteError(1), '第 1 行：CSV 格式錯誤（引號未關閉）');
  });
  test('csvLineMissingFields', () => {
    assert.equal(errorMessages.csvLineMissingFields(2), '第 2 行：缺少必要欄位（date 或 message）');
  });
  test('csvLineInvalidRemindTime', () => {
    assert.equal(
      errorMessages.csvLineInvalidRemindTime(3, '25:00'),
      '第 3 行：remind_time 格式錯誤（`25:00`），請使用 HH:MM',
    );
  });
  test('csvLineInvalidRemindDate', () => {
    assert.equal(
      errorMessages.csvLineInvalidRemindDate(4, '2026-05-10'),
      '第 4 行：remind_date 格式錯誤（`2026-05-10`），請使用 YYYYMMDD',
    );
  });
  test('csvLineInvalidDate', () => {
    assert.equal(errorMessages.csvLineInvalidDate(6, 'bad'), '第 6 行：日期格式錯誤（`bad`）');
  });
  test('csvLineRemindTimeExpired', () => {
    assert.equal(
      errorMessages.csvLineRemindTimeExpired(8, '2020/01/01'),
      '第 8 行：提醒時間已過，無法設定（`2020/01/01`）',
    );
  });
  test('csvLineDuplicate', () => {
    assert.equal(
      errorMessages.csvLineDuplicate(9, '2026/05/10', '14:30', '會議'),
      '第 9 行：`2026/05/10 14:30` 已有相同提醒「會議」',
    );
  });
});
