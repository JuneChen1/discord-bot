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
  return `${dateStr.slice(0, 4)}/${dateStr.slice(4, 6)}/${dateStr.slice(6, 8)}`;
}

// UTC timestamp → YYYY/MM/DD HH:MM（台灣時間 UTC+8）
function formatTaipeiTime(ts) {
  const d = new Date(ts + 8 * 60 * 60 * 1000);
  const YYYY = d.getUTCFullYear();
  const MM = String(d.getUTCMonth() + 1).padStart(2, '0');
  const DD = String(d.getUTCDate()).padStart(2, '0');
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${YYYY}/${MM}/${DD} ${hh}:${mm}`;
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

// 解析 "HH:MM" 字串，回傳 { hour, minute } 或 null（格式錯誤）
function parseRemindTime(timeStr) {
  if (!timeStr) return { hour: DEFAULT_REMIND_HOUR, minute: DEFAULT_REMIND_MINUTE };
  const m = timeStr.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  if (hour > 23 || minute > 59) return null;
  return { hour, minute };
}

function parseDateUTC(str) {
  return new Date(Date.UTC(+str.slice(0, 4), +str.slice(4, 6) - 1, +str.slice(6, 8)));
}

// 回傳指定提醒日期（預設前一天）指定時間（台灣時間 UTC+8）的 UTC timestamp (ms)
function calcReminderTime(eventDateStr, remindHour = DEFAULT_REMIND_HOUR, remindMinute = DEFAULT_REMIND_MINUTE, remindDateStr = null) {
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

// 判斷 reminders 中是否已有相同使用者、日期、時間、內容、提醒設定的重複項目
function isDuplicateReminder(reminders, { userId, eventDate, eventTime, message, remindTime, remindDate }) {
  return reminders.some(r =>
    r.userId === userId &&
    r.eventDate === eventDate &&
    r.eventTime === eventTime &&
    r.message === message &&
    r.remindTime === remindTime &&
    (r.remindDate ?? '') === remindDate
  );
}

// 將 patches 套用到現有提醒，未提供的欄位保留 existing 的值
// patches 中的 key 存在表示要更新，不存在表示保留舊值
function applyReminderEdits(existing, patches) {
  return {
    dateStr:       'date'       in patches ? patches.date       : existing.eventDate,
    message:       'message'    in patches ? patches.message    : existing.message,
    timeStr:       'time'       in patches ? patches.time       : existing.eventTime,
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
  calcReminderTime,
  isDuplicateReminder,
  applyReminderEdits,
};
