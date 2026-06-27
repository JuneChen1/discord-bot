const { format, parse, addHours, isValid } = require('date-fns');
const { errorMessages } = require('./errorHandle');
const { defaultRemindHour, defaultRemindMinute } = require('./config.json');

const timeRegex = /^\d{1,2}:\d{2}$/;
const timeFormat = 'H:mm';

// 通用驗證：先用 regex 確保格式（位數）正確，再用 date-fns isValid 確認數值範圍是否合法
function isValidDateTimeStr(str, regex, formatStr) {
  if (!regex.test(str)) return false;
  return isValid(parse(str, formatStr, new Date()));
}

// "HH:MM" → 分鐘數，格式不合回傳 NaN
function toMinutes(hhmm) {
  if (!isValidDateTimeStr(hhmm, timeRegex, timeFormat)) return NaN;
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

// 解析 YYYYMMDD 字串，回傳 date-fns 的 Date（無效日期會是 Invalid Date）
function parseEventDate(dateStr) {
  return parse(dateStr, 'yyyyMMdd', new Date());
}

// YYYYMMDD → YYYY/MM/DD；dateStr 非真實存在的日期時回傳原始字串，避免顯示時整段崩潰
function formatEventDate(dateStr) {
  const parsed = parseEventDate(dateStr);
  if (!isValid(parsed)) return `⚠️ 日期異常（${dateStr}）`;
  return format(parsed, 'yyyy/MM/dd');
}

// UTC timestamp → YYYY/MM/DD HH:MM（台灣時間 UTC+8）
function formatTaipeiTime(ts) {
  const taipei = addHours(new Date(ts), 8);
  // date-fns 的 format 會用 host 的 local getter 讀值，這裡先把時間平移成「local getter 讀出來等於 UTC 數值」，避免結果隨主機時區改變
  const asLocal = new Date(taipei.getTime() + taipei.getTimezoneOffset() * 60 * 1000);
  return format(asLocal, 'yyyy/MM/dd HH:mm');
}

// 支援帶引號欄位（欄位內含逗號時用雙引號包圍）；`""` 為引號跳脫；引號未關閉回傳 null
function parseCSVLine(line) {
  const fields = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      fields.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  if (inQuotes) return null;
  fields.push(current);
  return fields;
}

// { hour, minute } → "HH:MM"，補齊前導零
function formatHourMinute(hour, minute) {
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

// 解析 "HH:MM" 字串，回傳 { hour, minute } 或 null（格式錯誤）；timeStr 為空時回傳 defaultHour/defaultMinute
function parseRemindTime(
  timeStr,
  defaultHour = defaultRemindHour,
  defaultMinute = defaultRemindMinute,
) {
  if (!timeStr) return { hour: defaultHour, minute: defaultMinute };
  if (!isValidDateTimeStr(timeStr, timeRegex, timeFormat)) return null;
  const [hour, minute] = timeStr.split(':').map(Number);
  return { hour, minute };
}

// 取得使用者的個人預設提醒時間（未設定過則回傳系統預設）
function getUserRemindDefault(settings, userId) {
  const s = settings[userId];
  return {
    hour: s?.remindHour ?? defaultRemindHour,
    minute: s?.remindMinute ?? defaultRemindMinute,
  };
}

function parseDateUTC(str) {
  return new Date(Date.UTC(+str.slice(0, 4), +str.slice(4, 6) - 1, +str.slice(6, 8)));
}

// 嚴格驗證 YYYYMMDD 是否為真實存在的日期，而非僅 8 位數字
function isValidDateStr(dateStr) {
  return isValidDateTimeStr(dateStr, /^\d{8}$/, 'yyyyMMdd');
}

// 驗證日期（YYYYMMDD）與時間（HH:MM，空字串表示不檢查）格式是否正確，回傳對應的錯誤
function validateDateTimeFormat(dateStr, timeStr = '') {
  if (!isValidDateStr(dateStr)) {
    return { error: errorMessages.invalidEventDateFormat };
  }
  if (timeStr && !isValidDateTimeStr(timeStr, timeRegex, timeFormat)) {
    return { error: errorMessages.invalidEventTimeFormat };
  }
  return {};
}

// 回傳指定提醒日期（預設前一天）指定時間（台灣時間 UTC+8）的 UTC timestamp (ms)
function calcReminderTime(
  eventDateStr,
  remindHour = defaultRemindHour,
  remindMinute = defaultRemindMinute,
  remindDateStr = null,
) {
  if (!isValidDateStr(eventDateStr)) return null;
  let remindDay;
  if (remindDateStr) {
    if (!isValidDateStr(remindDateStr)) return null;
    remindDay = parseDateUTC(remindDateStr);
  } else {
    remindDay = parseDateUTC(eventDateStr);
    remindDay.setUTCDate(remindDay.getUTCDate() - 1);
  }
  // setUTCHours 接受負值（remindHour < 8 時自動往前一天），行為正確
  remindDay.setUTCHours(remindHour - 8, remindMinute, 0, 0);
  return remindDay.getTime();
}

// 依事件日期區間篩選並排序（toStr 為空字串表示無上限）
function filterRemindersByRange(reminders, userId, fromStr, toStr) {
  return reminders
    .filter(
      (r) => r.userId === userId && r.eventDate >= fromStr && (!toStr || r.eventDate <= toStr),
    )
    .sort((a, b) => a.eventDate.localeCompare(b.eventDate));
}

// 判斷 reminders 中是否已有相同使用者、日期、時間、內容、提醒設定的重複項目
function isDuplicateReminder(
  reminders,
  { userId, eventDate, eventTime, message, remindTime, remindDate },
) {
  return reminders.some(
    (r) =>
      r.userId === userId &&
      r.eventDate === eventDate &&
      r.eventTime === eventTime &&
      r.message === message &&
      r.remindTime === remindTime &&
      (r.remindDate ?? '') === remindDate,
  );
}

// 驗證提醒時間相關欄位，回傳 { error } 或 { remindTimeDisplay, remindAt }
function validateReminderInput(
  {
    dateStr,
    timeStr,
    remindDateStr,
    remindTimeRaw,
    defaultRemindHour: userDefaultHour,
    defaultRemindMinute: userDefaultMinute,
  },
  now = Date.now(),
) {
  const eventCheck = validateDateTimeFormat(dateStr, timeStr);
  if (eventCheck.error) {
    return eventCheck;
  }

  const parsedRemindTime = parseRemindTime(
    remindTimeRaw || null,
    userDefaultHour,
    userDefaultMinute,
  );
  if (!parsedRemindTime) {
    return { error: errorMessages.invalidRemindTimeFormat };
  }

  if (remindDateStr && !isValidDateStr(remindDateStr)) {
    return { error: errorMessages.invalidRemindDateFormat };
  }

  if (remindDateStr && remindDateStr > dateStr) {
    return {
      error: errorMessages.remindDateAfterEventDate(
        formatEventDate(remindDateStr),
        formatEventDate(dateStr),
      ),
    };
  }

  const remindTimeDisplay = formatHourMinute(parsedRemindTime.hour, parsedRemindTime.minute);

  if (
    remindDateStr &&
    remindDateStr === dateStr &&
    timeStr &&
    toMinutes(remindTimeDisplay) >= toMinutes(timeStr)
  ) {
    return {
      error: errorMessages.remindTimeAfterEventTimeSameDay(
        formatEventDate(dateStr),
        remindTimeDisplay,
        timeStr,
      ),
    };
  }

  // dateStr 與 remindDateStr（若有提供）已在上方驗證過，calcReminderTime 不會再回傳 null
  const remindAt = calcReminderTime(
    dateStr,
    parsedRemindTime.hour,
    parsedRemindTime.minute,
    remindDateStr || null,
  );

  if (remindAt <= now) {
    return { error: errorMessages.remindTimeExpired(formatTaipeiTime(remindAt)) };
  }

  return { remindTimeDisplay, remindAt };
}

// 將 patches 套用到現有提醒，未提供的欄位保留 existing 的值
// patches 中的 key 存在表示要更新，不存在表示保留舊值
function applyReminderEdits(existing, patches) {
  return {
    dateStr: 'date' in patches ? patches.date : existing.eventDate,
    message: 'message' in patches ? patches.message : existing.message,
    timeStr: 'time' in patches ? patches.time : existing.eventTime,
    remindDateStr: 'remindDate' in patches ? patches.remindDate : (existing.remindDate ?? ''),
    remindTimeRaw: 'remindTime' in patches ? patches.remindTime : existing.remindTime,
  };
}

module.exports = {
  toMinutes,
  formatEventDate,
  formatTaipeiTime,
  formatHourMinute,
  parseCSVLine,
  parseRemindTime,
  getUserRemindDefault,
  isValidDateStr,
  validateDateTimeFormat,
  calcReminderTime,
  filterRemindersByRange,
  isDuplicateReminder,
  validateReminderInput,
  applyReminderEdits,
};
