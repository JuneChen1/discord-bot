const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const {
  toMinutes,
  formatEventDate,
  formatTaipeiTime,
  getTaipeiDateStr,
  parseCSVLine,
  parseRemindTime,
  getUserRemindDefault,
  isValidDateStr,
  validateDateTimeFormat,
  calcReminderTime,
  filterRemindersByRange,
  isDuplicateReminder,
  applyReminderEdits,
  validateReminderInput,
} = require('../lib/utils');
const { errorMessages } = require('../lib/errorHandle');
const { defaultRemindHour, defaultRemindMinute } = require('../lib/config.json');

// ── filterRemindersByRange ────────────────────────────────

describe('filterRemindersByRange', () => {
  const r = (userId, eventDate) => ({ userId, eventDate, remindAt: 0 });

  const REMINDERS = [
    r('u1', '20260601'),
    r('u1', '20260615'),
    r('u1', '20260630'),
    r('u1', '20260701'),
    r('u2', '20260610'),
  ];

  test('有 from 和 to：只回傳區間內（含邊界）', () => {
    const result = filterRemindersByRange(REMINDERS, 'u1', '20260601', '20260630');
    assert.deepEqual(
      result.map((r) => r.eventDate),
      ['20260601', '20260615', '20260630'],
    );
  });

  test('to 等於 from：只回傳當天', () => {
    const result = filterRemindersByRange(REMINDERS, 'u1', '20260615', '20260615');
    assert.deepEqual(
      result.map((r) => r.eventDate),
      ['20260615'],
    );
  });

  test('無上限（toStr 空字串）：回傳 from 之後所有提醒', () => {
    const result = filterRemindersByRange(REMINDERS, 'u1', '20260615', '');
    assert.deepEqual(
      result.map((r) => r.eventDate),
      ['20260615', '20260630', '20260701'],
    );
  });

  test('不同使用者的提醒不回傳', () => {
    const result = filterRemindersByRange(REMINDERS, 'u1', '20260601', '20260630');
    assert.ok(result.every((r) => r.userId === 'u1'));
  });

  test('區間內無符合 → 空陣列', () => {
    const result = filterRemindersByRange(REMINDERS, 'u1', '20260801', '20260831');
    assert.deepEqual(result, []);
  });

  test('空 reminders → 空陣列', () => {
    assert.deepEqual(filterRemindersByRange([], 'u1', '20260601', '20260630'), []);
  });

  test('結果依 eventDate 升冪排序', () => {
    const unsorted = [r('u1', '20260630'), r('u1', '20260601'), r('u1', '20260615')];
    const result = filterRemindersByRange(unsorted, 'u1', '20260601', '20260630');
    assert.deepEqual(
      result.map((r) => r.eventDate),
      ['20260601', '20260615', '20260630'],
    );
  });

  test('跨月區間', () => {
    const result = filterRemindersByRange(REMINDERS, 'u1', '20260601', '20260701');
    assert.deepEqual(
      result.map((r) => r.eventDate),
      ['20260601', '20260615', '20260630', '20260701'],
    );
  });
});

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
    const result = applyReminderEdits(EXISTING, {
      message: '新主題',
      date: '20260601',
      remindTime: '08:00',
    });
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
  const BASE = {
    userId: 'u1',
    eventDate: '20260510',
    eventTime: '14:30',
    message: '會議',
    remindTime: '22:00',
    remindDate: '',
  };
  const makeReminder = (overrides = {}) => ({ ...BASE, ...overrides });
  const BASE_OPTS = {
    userId: 'u1',
    eventDate: '20260510',
    eventTime: '14:30',
    message: '會議',
    remindTime: '22:00',
    remindDate: '',
  };

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
    assert.equal(
      isDuplicateReminder([makeReminder()], { ...BASE_OPTS, eventDate: '20260511' }),
      false,
    );
  });
  test('不同 eventTime → false', () => {
    assert.equal(
      isDuplicateReminder([makeReminder()], { ...BASE_OPTS, eventTime: '15:00' }),
      false,
    );
  });
  test('不同 message → false', () => {
    assert.equal(isDuplicateReminder([makeReminder()], { ...BASE_OPTS, message: '其他' }), false);
  });
  test('不同 remindTime → false', () => {
    assert.equal(
      isDuplicateReminder([makeReminder()], { ...BASE_OPTS, remindTime: '21:00' }),
      false,
    );
  });
  test('有 remindDate 且相同 → true', () => {
    assert.equal(
      isDuplicateReminder([makeReminder({ remindDate: '20260509' })], {
        ...BASE_OPTS,
        remindDate: '20260509',
      }),
      true,
    );
  });
  test('有 remindDate 但不同 → false', () => {
    assert.equal(
      isDuplicateReminder([makeReminder({ remindDate: '20260509' })], {
        ...BASE_OPTS,
        remindDate: '20260508',
      }),
      false,
    );
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
  test('小時超過 23 → NaN', () => {
    assert.ok(isNaN(toMinutes('24:00')));
  });
  test('分鐘超過 59 → NaN', () => {
    assert.ok(isNaN(toMinutes('23:60')));
  });
  test('缺位分鐘（單位數）→ NaN', () => {
    assert.ok(isNaN(toMinutes('14:3')));
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

// ── getTaipeiDateStr ──────────────────────────────────────

describe('getTaipeiDateStr', () => {
  test('UTC+8 偏移正確：14:00 UTC → 22:00 台灣，仍同一天', () => {
    const ts = Date.UTC(2026, 4, 10, 14, 0, 0, 0);
    assert.equal(getTaipeiDateStr(ts), '20260510');
  });
  test('跨日邊界：16:30 UTC → 隔天 00:30 台灣', () => {
    const ts = Date.UTC(2026, 4, 10, 16, 30, 0, 0);
    assert.equal(getTaipeiDateStr(ts), '20260511');
  });
  test('跨月：4/30 16:00 UTC → 5/1 台灣', () => {
    const ts = Date.UTC(2026, 3, 30, 16, 0, 0, 0);
    assert.equal(getTaipeiDateStr(ts), '20260501');
  });
  test('跨年：12/31 16:00 UTC → 隔年 1/1 台灣', () => {
    const ts = Date.UTC(2025, 11, 31, 16, 0, 0, 0);
    assert.equal(getTaipeiDateStr(ts), '20260101');
  });
});

// ── parseCSVLine ──────────────────────────────────────────

describe('parseCSVLine', () => {
  test('基本三欄', () => {
    assert.deepEqual(parseCSVLine('20260510,hello,14:30'), ['20260510', 'hello', '14:30']);
  });
  test('帶引號欄位（含逗號）', () => {
    assert.deepEqual(parseCSVLine('20260510,"hello, world",14:30'), [
      '20260510',
      'hello, world',
      '14:30',
    ]);
  });
  test('尾端空欄位', () => {
    assert.deepEqual(parseCSVLine('20260510,hello,,'), ['20260510', 'hello', '', '']);
  });
  test('全空欄位', () => {
    assert.deepEqual(parseCSVLine(','), ['', '']);
  });
  test('引號包圍但無逗號', () => {
    assert.deepEqual(parseCSVLine('"20260510","hello"'), ['20260510', 'hello']);
  });
  test('五欄完整格式', () => {
    assert.deepEqual(parseCSVLine('20260510,會議,14:30,21:00,20260509'), [
      '20260510',
      '會議',
      '14:30',
      '21:00',
      '20260509',
    ]);
  });
  test('引號內 "" 跳脫為單一引號字元', () => {
    assert.deepEqual(parseCSVLine('20260510,"say ""hi""",14:30'), [
      '20260510',
      'say "hi"',
      '14:30',
    ]);
  });
  test('引號未關閉 → null', () => {
    assert.equal(parseCSVLine('20260510,"未關閉'), null);
  });
});

// ── parseRemindTime ───────────────────────────────────────

describe('parseRemindTime', () => {
  test('null → 預設 22:00', () => {
    assert.deepEqual(parseRemindTime(null), {
      hour: defaultRemindHour,
      minute: defaultRemindMinute,
    });
  });
  test('空字串 → 預設 22:00', () => {
    assert.deepEqual(parseRemindTime(''), {
      hour: defaultRemindHour,
      minute: defaultRemindMinute,
    });
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
  test('空值時可改用自訂預設值（個人預設提醒時間）', () => {
    assert.deepEqual(parseRemindTime(null, 21, 0), { hour: 21, minute: 0 });
  });
  test('有值時忽略自訂預設值', () => {
    assert.deepEqual(parseRemindTime('18:30', 21, 0), { hour: 18, minute: 30 });
  });
});

// ── getUserRemindDefault ──────────────────────────────────

describe('getUserRemindDefault', () => {
  test('未設定過 → 回傳系統預設', () => {
    assert.deepEqual(getUserRemindDefault({}, 'u1'), {
      hour: defaultRemindHour,
      minute: defaultRemindMinute,
    });
  });
  test('已設定過 → 回傳個人設定', () => {
    const settings = { u1: { remindHour: 21, remindMinute: 0 } };
    assert.deepEqual(getUserRemindDefault(settings, 'u1'), { hour: 21, minute: 0 });
  });
  test('只回傳對應 userId 的設定，不受其他使用者影響', () => {
    const settings = { u1: { remindHour: 21, remindMinute: 0 } };
    assert.deepEqual(getUserRemindDefault(settings, 'u2'), {
      hour: defaultRemindHour,
      minute: defaultRemindMinute,
    });
  });
});

// ── isValidDateStr ────────────────────────────────────────

describe('isValidDateStr', () => {
  test('正常日期 → true', () => {
    assert.equal(isValidDateStr('20260510'), true);
  });
  test('1 月 32 日（不存在）→ false', () => {
    assert.equal(isValidDateStr('20270132'), false);
  });
  test('2 月 30 日（不存在）→ false', () => {
    assert.equal(isValidDateStr('20260230'), false);
  });
  test('13 月（不存在）→ false', () => {
    assert.equal(isValidDateStr('20261301'), false);
  });
  test('0 月 0 日（不存在）→ false', () => {
    assert.equal(isValidDateStr('20260000'), false);
  });
  test('閏年 2/29 → true', () => {
    assert.equal(isValidDateStr('20240229'), true);
  });
  test('非閏年 2/29（不存在）→ false', () => {
    assert.equal(isValidDateStr('20230229'), false);
  });
  test('非 8 位數 → false', () => {
    assert.equal(isValidDateStr('2026051'), false);
  });
  test('含非數字 → false', () => {
    assert.equal(isValidDateStr('2026ABCD'), false);
  });
});

// ── validateDateTimeFormat ────────────────────────────────

describe('validateDateTimeFormat', () => {
  test('日期、時間皆合法 → 無 error', () => {
    assert.deepEqual(validateDateTimeFormat('20260510', '14:30'), {});
  });
  test('時間為空字串 → 不檢查時間，無 error', () => {
    assert.deepEqual(validateDateTimeFormat('20260510', ''), {});
  });
  test('不帶時間參數 → 不檢查時間，無 error', () => {
    assert.deepEqual(validateDateTimeFormat('20260510'), {});
  });
  test('日期格式錯誤 → 回傳日期格式錯誤', () => {
    assert.equal(
      validateDateTimeFormat('20261301', '14:30').error,
      errorMessages.invalidEventDateFormat,
    );
  });
  test('時間格式錯誤 → 回傳時間格式錯誤', () => {
    assert.equal(
      validateDateTimeFormat('20260510', '25:00').error,
      errorMessages.invalidEventTimeFormat,
    );
  });
  test('日期與時間都錯誤 → 優先回傳日期格式錯誤', () => {
    assert.equal(
      validateDateTimeFormat('20261301', '25:00').error,
      errorMessages.invalidEventDateFormat,
    );
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
  test('8 位數但非真實日期的 eventDateStr（1 月 32 日）→ null', () => {
    assert.equal(calcReminderTime('20270132'), null);
  });
  test('8 位數但非真實日期的 remindDateStr（2 月 30 日）→ null', () => {
    assert.equal(calcReminderTime('20260510', 22, 0, '20260230'), null);
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

// ── validateReminderInput ─────────────────────────────────

describe('validateReminderInput', () => {
  test('事件日期為 8 位數但非真實日期（1 月 32 日）→ 回傳 error，不丟例外', () => {
    const result = validateReminderInput({
      dateStr: '20270132',
      timeStr: '',
      remindDateStr: '',
      remindTimeRaw: '',
    });
    assert.ok(result.error);
    assert.equal(result.remindAt, undefined);
  });
  test('提醒日期為 8 位數但非真實日期（2 月 30 日）→ 回傳 error', () => {
    const result = validateReminderInput({
      dateStr: '20260510',
      timeStr: '',
      remindDateStr: '20260230',
      remindTimeRaw: '',
    });
    assert.ok(result.error);
  });
  test('正常輸入 → 回傳 remindTimeDisplay 與 remindAt', () => {
    const result = validateReminderInput(
      { dateStr: '20260510', timeStr: '14:30', remindDateStr: '', remindTimeRaw: '09:00' },
      Date.UTC(2026, 0, 1),
    );
    assert.equal(result.error, undefined);
    assert.equal(result.remindTimeDisplay, '09:00');
  });
  test('事件時間格式錯誤 → 回傳事件時間格式錯誤', () => {
    const result = validateReminderInput({
      dateStr: '20260510',
      timeStr: '25:00',
      remindDateStr: '',
      remindTimeRaw: '',
    });
    assert.equal(result.error, errorMessages.invalidEventTimeFormat);
  });

  describe('日期格式錯誤的判斷優先於提醒時間已過', () => {
    test('事件日期無效（非閏年 2/29）且明顯是過去 → 回傳日期格式錯誤，不是已過期', () => {
      const result = validateReminderInput(
        { dateStr: '20230229', timeStr: '', remindDateStr: '', remindTimeRaw: '' },
        Date.UTC(2026, 0, 1),
      );
      assert.equal(result.error, errorMessages.invalidEventDateFormat);
    });

    test('提醒日期無效（2/30 不存在）→ 回傳提醒日期格式錯誤，不是已過期', () => {
      const result = validateReminderInput(
        { dateStr: '20300101', timeStr: '', remindDateStr: '20300230', remindTimeRaw: '' },
        Date.UTC(2026, 0, 1),
      );
      assert.equal(result.error, errorMessages.invalidRemindDateFormat);
    });

    test('日期格式正確但確實已過期 → 才回傳已過期', () => {
      const result = validateReminderInput(
        { dateStr: '20200101', timeStr: '', remindDateStr: '', remindTimeRaw: '' },
        Date.UTC(2026, 0, 1),
      );
      assert.match(result.error, /已過/);
      assert.notEqual(result.error, errorMessages.invalidEventDateFormat);
    });
  });
});
