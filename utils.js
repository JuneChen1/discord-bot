const { format, parse, addHours } = require('date-fns');
const DEFAULT_REMIND_HOUR = 22;
const DEFAULT_REMIND_MINUTE = 0;

// "HH:MM" → 分鐘數，格式不合回傳 NaN
function toMinutes(hhmm) {
  if (!/^\d{1,2}:\d{2}$/.test(hhmm)) return NaN;
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

// YYYYMMDD → YYYY/MM/DD
function formatEventDate(dateStr) {
  return format(parse(dateStr, 'yyyyMMdd', new Date()), 'yyyy/MM/dd');
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

// 解析 "HH:MM" 字串，回傳 { hour, minute } 或 null（格式錯誤）；timeStr 為空時回傳 defaultHour/defaultMinute
function parseRemindTime(
  timeStr,
  defaultHour = DEFAULT_REMIND_HOUR,
  defaultMinute = DEFAULT_REMIND_MINUTE,
) {
  if (!timeStr) return { hour: defaultHour, minute: defaultMinute };
  const m = timeStr.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  if (hour > 23 || minute > 59) return null;
  return { hour, minute };
}

// 取得使用者的個人預設提醒時間（未設定過則回傳系統預設）
function getUserRemindDefault(settings, userId) {
  const s = settings[userId];
  return {
    hour: s?.remindHour ?? DEFAULT_REMIND_HOUR,
    minute: s?.remindMinute ?? DEFAULT_REMIND_MINUTE,
  };
}

function parseDateUTC(str) {
  return new Date(Date.UTC(+str.slice(0, 4), +str.slice(4, 6) - 1, +str.slice(6, 8)));
}

// 回傳指定提醒日期（預設前一天）指定時間（台灣時間 UTC+8）的 UTC timestamp (ms)
function calcReminderTime(
  eventDateStr,
  remindHour = DEFAULT_REMIND_HOUR,
  remindMinute = DEFAULT_REMIND_MINUTE,
  remindDateStr = null,
) {
  if (!/^\d{8}$/.test(eventDateStr)) return null;
  let remindDay;
  if (remindDateStr) {
    if (!/^\d{8}$/.test(remindDateStr)) return null;
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
  { dateStr, timeStr, remindDateStr, remindTimeRaw, defaultRemindHour, defaultRemindMinute },
  now = Date.now(),
) {
  const parsedRemindTime = parseRemindTime(
    remindTimeRaw || null,
    defaultRemindHour,
    defaultRemindMinute,
  );
  if (!parsedRemindTime) {
    return { error: '❌ 提醒時間格式錯誤！請使用 `HH:MM`，例如 `18:30`。' };
  }

  if (remindDateStr && !/^\d{8}$/.test(remindDateStr)) {
    return { error: '❌ 提醒日期格式錯誤！請使用 `YYYYMMDD`，例如 `20260509`。' };
  }

  if (remindDateStr && remindDateStr > dateStr) {
    return {
      error: `❌ 提醒日期（\`${formatEventDate(remindDateStr)}\`）不能晚於事件日期（\`${formatEventDate(dateStr)}\`）！`,
    };
  }

  const remindTimeDisplay = `${String(parsedRemindTime.hour).padStart(2, '0')}:${String(parsedRemindTime.minute).padStart(2, '0')}`;

  if (
    remindDateStr &&
    remindDateStr === dateStr &&
    timeStr &&
    toMinutes(remindTimeDisplay) >= toMinutes(timeStr)
  ) {
    return {
      error: `❌ 提醒日期與事件同天（\`${formatEventDate(dateStr)}\`），提醒時間（\`${remindTimeDisplay}\`）不能晚於或等於事件時間（\`${timeStr}\`）！`,
    };
  }

  const remindAt = calcReminderTime(
    dateStr,
    parsedRemindTime.hour,
    parsedRemindTime.minute,
    remindDateStr || null,
  );

  if (!remindAt) {
    return { error: '❌ 日期格式錯誤！請使用 `YYYYMMDD`，例如 `20260510`。' };
  }

  if (remindAt <= now) {
    return {
      error: `❌ 提醒時間 ${formatTaipeiTime(remindAt)} 已過，無法設定提醒！請調整事件日期或提醒時間。`,
    };
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
  DEFAULT_REMIND_HOUR,
  DEFAULT_REMIND_MINUTE,
  toMinutes,
  formatEventDate,
  formatTaipeiTime,
  parseCSVLine,
  parseRemindTime,
  getUserRemindDefault,
  calcReminderTime,
  filterRemindersByRange,
  validateReminderInput,
  isDuplicateReminder,
  applyReminderEdits,
};
