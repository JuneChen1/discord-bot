const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const {
  addMonthsUTCClamped,
  calcNextOccurrenceDate,
  parseDateUTC,
  formatDateStrUTC,
} = require('../lib/utils');
const { buildNextOccurrence } = require('../lib/reminderHelpers');

// ── addMonthsUTCClamped ────────────────────────────────

describe('addMonthsUTCClamped', () => {
  test('一般加月：不跨月底問題', () => {
    const result = addMonthsUTCClamped(parseDateUTC('20260115'), 1);
    assert.equal(formatDateStrUTC(result), '20260215');
  });

  test('大月溢位到小月：1/31 + 1 月（平年）→ 2/28', () => {
    const result = addMonthsUTCClamped(parseDateUTC('20250131'), 1);
    assert.equal(formatDateStrUTC(result), '20250228');
  });

  test('閏年 2 月：1/31 + 1 月（閏年）→ 2/29', () => {
    const result = addMonthsUTCClamped(parseDateUTC('20240131'), 1);
    assert.equal(formatDateStrUTC(result), '20240229');
  });

  test('跨年：12/31 + 1 月 → 隔年 1/31', () => {
    const result = addMonthsUTCClamped(parseDateUTC('20251231'), 1);
    assert.equal(formatDateStrUTC(result), '20260131');
  });
});

// ── calcNextOccurrenceDate ────────────────────────────────

describe('calcNextOccurrenceDate', () => {
  test('daily：+1 天', () => {
    assert.equal(calcNextOccurrenceDate('20260510', 'daily'), '20260511');
  });

  test('weekly：+7 天，星期幾不變', () => {
    assert.equal(calcNextOccurrenceDate('20260504', 'weekly'), '20260511');
  });

  test('monthly：+1 個月，含月底溢位', () => {
    assert.equal(calcNextOccurrenceDate('20260131', 'monthly'), '20260228');
  });
});

// ── buildNextOccurrence ────────────────────────────────

describe('buildNextOccurrence', () => {
  const baseReminder = {
    id: 'u1-123-abc',
    userId: 'u1',
    userName: 'tester',
    channelId: 'c1',
    message: '週會',
    eventDate: '20260504',
    eventTime: '',
    remindTime: '22:00',
    remindDate: '20260503',
    remindAt: 0,
    recurrence: {
      type: 'weekly',
      remindOffsetDays: 1,
      endDate: null,
      endCount: null,
      occurrenceIndex: 1,
    },
  };

  test('一般情況：回傳下一場次，eventDate 推進、occurrenceIndex +1', () => {
    const next = buildNextOccurrence(baseReminder);
    assert.equal(next.eventDate, '20260511');
    assert.equal(next.recurrence.occurrenceIndex, 2);
    assert.equal(next.id, baseReminder.id);
  });

  test('達到 endDate：下一場次事件日期超過 endDate → 回傳 null', () => {
    const reminder = {
      ...baseReminder,
      recurrence: { ...baseReminder.recurrence, endDate: '20260505' },
    };
    assert.equal(buildNextOccurrence(reminder), null);
  });

  test('達到 endCount：下一場次序號超過 endCount → 回傳 null', () => {
    const reminder = {
      ...baseReminder,
      recurrence: { ...baseReminder.recurrence, occurrenceIndex: 3, endCount: 3 },
    };
    assert.equal(buildNextOccurrence(reminder), null);
  });

  test('remindOffsetDays 位移：下一場次的 remindDate 正確依偏移天數位移', () => {
    const reminder = {
      ...baseReminder,
      recurrence: { ...baseReminder.recurrence, remindOffsetDays: 3 },
    };
    const next = buildNextOccurrence(reminder);
    assert.equal(next.remindDate, '20260508');
  });
});
