const { computeRemainingOccurrences } = require('./reminderHelpers');

// 欄位順序與 /remind-import 相同，匯出的檔案可直接再匯入
const csvHeader = [
  'date',
  'message',
  'time',
  'remind_time',
  'remind_date',
  'type',
  'remind_offset_days',
  'end_date',
  'count',
];

// 含逗號、雙引號或換行的欄位以雙引號包圍，內部雙引號以 `""` 跳脫（與 utils.parseCSVLine 對應）
function escapeCsvField(value) {
  const str = String(value ?? '');
  return /[",\r\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

function reminderToCsvRow(r) {
  // /remind-import 以換行切分資料列，欄位內的換行無法還原，改以空白取代
  const message = r.message.replace(/\r?\n/g, ' ');
  const common = [r.eventDate, message, r.eventTime, r.remindTime];

  if (!r.recurrence) return [...common, r.remindDate, '', '', '', ''];

  // 週期提醒：remind_date 由 remind_offset_days 推算故留空；end_date 與 count 只能擇一，
  // count 輸出「含本場的剩餘次數」，匯入後從本場重新起算即可延續原本的系列
  const { type, remindOffsetDays, endDate, endCount } = r.recurrence;
  return [
    ...common,
    '',
    type,
    remindOffsetDays,
    endCount ? '' : endDate,
    endCount ? computeRemainingOccurrences(r.recurrence, r.eventDate) : '',
  ];
}

// 產生提醒清單的 CSV 文字；reminders 需先由呼叫端過濾為單一使用者。
// 開頭加 UTF-8 BOM 讓 Excel 正確顯示中文（/remind-import 讀取時會去掉）
function buildRemindersCsv(reminders) {
  const sorted = [...reminders].sort((a, b) => a.eventDate.localeCompare(b.eventDate));
  const rows = [csvHeader, ...sorted.map(reminderToCsvRow)];
  return `﻿${rows.map((row) => row.map(escapeCsvField).join(',')).join('\r\n')}\r\n`;
}

module.exports = { buildRemindersCsv };
