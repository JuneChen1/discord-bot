// 集中管理所有對使用者顯示的錯誤/失敗訊息文字
// 注意：這裡只負責組字串，不依賴 utils.js 的格式化函式（避免循環依賴），
// 需要日期/時間顯示文字時，由呼叫端先用 formatEventDate / formatTaipeiTime 轉換好再傳入

// 共用核心句子：標準回覆（❌ 開頭、！結尾）
// （duplicateReminder / csvLineDuplicate 文字本身不同，不適用此模式，各自獨立定義）
const core = {
  remindDateAfterEventDate: (remindDateDisplay, eventDateDisplay) =>
    `提醒日期（\`${remindDateDisplay}\`）不能晚於事件日期（\`${eventDateDisplay}\`）`,
  remindTimeAfterEventTimeSameDay: (eventDateDisplay, remindTimeDisplay, eventTimeStr) =>
    `提醒日期與事件同天（\`${eventDateDisplay}\`），提醒時間（\`${remindTimeDisplay}\`）不能晚於或等於事件時間（\`${eventTimeStr}\`）`,
};

const errorMessages = {
  // 通用
  unexpectedError: '❌ 發生未預期的錯誤，請稍後再試。',

  // /remind、/remind-edit 共用：建立或修改後發現重複
  duplicateReminder: (eventDateDisplay, eventTimeStr, message) =>
    `❌ 你在 \`${eventDateDisplay}${eventTimeStr ? ` ${eventTimeStr}` : ''}\` 已有相同內容的提醒：「${message}」`,

  // /remind-default
  timeAndResetConflict: '❌ `time` 和 `reset` 不能同時使用。',
  invalidTimeFormat: '❌ 時間格式錯誤！請使用 `HH:MM`，例如 `21:00`。',

  // /reminders-range
  invalidDateRangeFormat: '❌ 日期格式錯誤，請使用 YYYYMMDD（例如 20260601）。',
  invalidDateRangeOrder: '❌ 起始日期不可晚於結束日期。',
  dateRangeInPast: (toDisplay) => `❌ 查詢區間已過期（最晚為 ${toDisplay}），請查詢今天或之後的日期。`,

  // /remind-edit
  noEditFieldsProvided:
    '❌ 請至少提供一個要修改的欄位（message、date、time、remind_date、remind_time）。',
  reminderNotFound: (targetId) => `❌ 找不到 ID 為 \`${targetId}\` 的提醒。`,
  notOwnerEdit: '❌ 你只能編輯自己的提醒。',

  // /remind-delete
  reminderNotFoundForDelete: (targetId) => `\`${targetId}\`：找不到此 ID，多個 ID 請用空白隔開`,
  notOwnerDelete: (targetId) => `\`${targetId}\`：你只能刪除自己的提醒`,

  // /remind-import
  invalidCsvFile: '❌ 請上傳 `.csv` 格式的檔案。',
  csvReadFailed: '❌ 無法讀取檔案，請稍後再試。',
  csvEmpty: '❌ CSV 檔案是空的。',
  csvHeaderOnly: '❌ CSV 只有 header，沒有資料列。',
  csvLineQuoteError: (line) => `第 ${line} 行：CSV 格式錯誤（引號未關閉）`,
  csvLineMissingFields: (line) => `第 ${line} 行：缺少必要欄位（date 或 message）`,
  csvLineInvalidRemindTime: (line, remindTimeRaw) =>
    `第 ${line} 行：remind_time 格式錯誤（\`${remindTimeRaw}\`），請使用 HH:MM`,
  csvLineInvalidRemindDate: (line, remindDateRaw) =>
    `第 ${line} 行：remind_date 格式錯誤（\`${remindDateRaw}\`），請使用 YYYYMMDD`,
  csvLineRemindDateAfterEventDate: (line, remindDateDisplay, eventDateDisplay) =>
    `第 ${line} 行：${core.remindDateAfterEventDate(remindDateDisplay, eventDateDisplay)}`,
  csvLineRemindTimeAfterEventTime: (line, eventDateDisplay, remindTimeDisplay, eventTimeStr) =>
    `第 ${line} 行：${core.remindTimeAfterEventTimeSameDay(eventDateDisplay, remindTimeDisplay, eventTimeStr)}`,
  csvLineInvalidDate: (line, dateStr) => `第 ${line} 行：日期格式錯誤（\`${dateStr}\`）`,
  csvLineRemindTimeExpired: (line, eventDateDisplay) =>
    `第 ${line} 行：提醒時間已過，無法設定（\`${eventDateDisplay}\`）`,
  csvLineDuplicate: (line, eventDateDisplay, eventTimeStr, message) =>
    `第 ${line} 行：\`${eventDateDisplay}${eventTimeStr ? ` ${eventTimeStr}` : ''}\` 已有相同提醒「${message}」`,

  // utils.js validateReminderInput
  invalidRemindTimeFormat: '❌ 提醒時間格式錯誤！請使用 `HH:MM`，例如 `18:30`。',
  invalidRemindDateFormat: '❌ 提醒日期格式錯誤！請使用 `YYYYMMDD`，例如 `20260509`。',
  remindDateAfterEventDate: (remindDateDisplay, eventDateDisplay) =>
    `❌ ${core.remindDateAfterEventDate(remindDateDisplay, eventDateDisplay)}！`,
  remindTimeAfterEventTimeSameDay: (eventDateDisplay, remindTimeDisplay, eventTimeStr) =>
    `❌ ${core.remindTimeAfterEventTimeSameDay(eventDateDisplay, remindTimeDisplay, eventTimeStr)}！`,
  invalidEventDateFormat: '❌ 日期格式錯誤！請使用 `YYYYMMDD`，例如 `20260510`。',
  invalidEventTimeFormat: '❌ 時間格式錯誤！請使用 `HH:MM`，例如 `14:30`。',
  remindTimeExpired: (remindAtDisplay) =>
    `❌ 提醒時間 ${remindAtDisplay} 已過，無法設定提醒！請調整事件日期或提醒時間。`,
};

module.exports = { errorMessages };
