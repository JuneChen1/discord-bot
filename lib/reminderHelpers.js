const { EmbedBuilder } = require('discord.js');
const {
  formatEventDate,
  formatTaipeiTime,
  isDuplicateReminder,
  parseDateUTC,
  calcNextOccurrenceDate,
  addDaysUTC,
  formatDateStrUTC,
  calcReminderTime,
  parseRemindTime,
} = require('./utils');
const { maxRemindersDisplay } = require('./config.json');

const weekdayLabels = ['日', '一', '二', '三', '四', '五', '六'];

const maxEmbedFields = 25; // Discord embed 單則最多 25 個 field，硬上限
const maxRemindersList = Math.min(maxRemindersDisplay, maxEmbedFields);

// reminder.id 產生規則：userId-時間戳-(批次序號-)隨機字串；suffix 用於同批次匯入避免碰撞
function generateReminderId(userId, suffix) {
  const suffixPart = suffix !== undefined ? `${suffix}-` : '';
  const random = Math.random().toString(36).slice(2);
  return `${userId}-${Date.now()}-${suffixPart}${random}`;
}

// 組出儲存於 reminders.json 的提醒物件；remindDate 為空時不寫入該欄位；recurrence 為週期提醒專用，僅在提供時寫入
function buildReminderRecord({
  id,
  userId,
  userName,
  channelId,
  message,
  eventDate,
  eventTime,
  remindTime,
  remindDate,
  remindAt,
  recurrence,
}) {
  const record = {
    id,
    userId,
    userName,
    channelId,
    message,
    eventDate,
    eventTime,
    remindTime,
    remindAt,
  };
  if (remindDate) record.remindDate = remindDate;
  if (recurrence) record.recurrence = recurrence;
  return record;
}

// 計算週期提醒的下一場次；已達 endDate/endCount 結束條件時回傳 null（系列結束）
function buildNextOccurrence(reminder) {
  const { recurrence } = reminder;
  const nextEventDate = calcNextOccurrenceDate(reminder.eventDate, recurrence.type);
  const nextOccurrenceIndex = recurrence.occurrenceIndex + 1;

  if (recurrence.endDate && nextEventDate > recurrence.endDate) return null;
  if (recurrence.endCount && nextOccurrenceIndex > recurrence.endCount) return null;

  const nextRemindDate = formatDateStrUTC(
    addDaysUTC(parseDateUTC(nextEventDate), -recurrence.remindOffsetDays),
  );
  const { hour, minute } = parseRemindTime(reminder.remindTime);
  const nextRemindAt = calcReminderTime(nextEventDate, hour, minute, nextRemindDate);

  return buildReminderRecord({
    id: reminder.id,
    userId: reminder.userId,
    userName: reminder.userName,
    channelId: reminder.channelId,
    message: reminder.message,
    eventDate: nextEventDate,
    eventTime: reminder.eventTime,
    remindTime: reminder.remindTime,
    remindDate: nextRemindDate,
    remindAt: nextRemindAt,
    recurrence: { ...recurrence, occurrenceIndex: nextOccurrenceIndex },
  });
}

const monthlyRemainingMaxIterations = 1200; // 上限 100 年，避免資料異常（endDate/endCount 皆缺）時無窮迴圈

// 計算週期提醒從目前這場（eventDate）起，還剩幾次會發生（含本場）；
// recurrence 缺少 endCount/endDate（不應發生，屬資料異常）時回傳 null
function computeRemainingOccurrences(recurrence, eventDate) {
  if (recurrence.endCount) {
    return recurrence.endCount - recurrence.occurrenceIndex + 1;
  }
  if (!recurrence.endDate) return null;

  if (recurrence.type === 'daily' || recurrence.type === 'weekly') {
    const intervalDays = recurrence.type === 'daily' ? 1 : 7;
    const diffDays = Math.round(
      (parseDateUTC(recurrence.endDate) - parseDateUTC(eventDate)) / (24 * 60 * 60 * 1000),
    );
    return Math.floor(diffDays / intervalDays) + 1;
  }

  // monthly：跨月會 clamp（例：1/31 + 1 月 → 2/28），日期無固定天數間隔，改用逐月遞增計算，並設迭代上限保底
  let count = 1;
  let current = eventDate;
  for (let i = 0; i < monthlyRemainingMaxIterations; i++) {
    const next = calcNextOccurrenceDate(current, recurrence.type);
    if (next > recurrence.endDate) break;
    count++;
    current = next;
  }
  return count;
}

// 週期提醒清單標示，例如「🔁 每週一」「🔁 每月5日」「🔁 每天」
function buildRecurrenceLabel(recurrence, eventDate) {
  const eventDateUTC = parseDateUTC(eventDate);
  switch (recurrence.type) {
    case 'daily':
      return '🔁 每天';
    case 'weekly':
      return `🔁 每週${weekdayLabels[eventDateUTC.getUTCDay()]}`;
    case 'monthly':
      return `🔁 每月${eventDateUTC.getUTCDate()}日`;
    default:
      return '🔁';
  }
}

function isDuplicate(reminders, { userId, eventDate, eventTime, message, remindTime, remindDate }) {
  return isDuplicateReminder(reminders, {
    userId,
    eventDate,
    eventTime,
    message,
    remindTime,
    remindDate,
  });
}

// 事件日期顯示：YYYY/MM/DD，缺少日期顯示「未知」，有指定時間則加上 🕐 HH:MM
function buildEventDateDisplay(eventDate, eventTime) {
  const formatted = eventDate ? formatEventDate(eventDate) : '未知';
  return eventTime ? `${formatted}　🕐 ${eventTime}` : formatted;
}

// /remind、/remind-edit 共用的「事件日期／頻道／內容／提醒時間」結果 embed
function buildReminderResultEmbed({
  title,
  color,
  channelId,
  message,
  eventDate,
  eventTime,
  remindAt,
  footerId,
}) {
  return new EmbedBuilder()
    .setTitle(title)
    .addFields(
      { name: '📅 事件日期', value: buildEventDateDisplay(eventDate, eventTime), inline: true },
      { name: '📍 頻道', value: `<#${channelId}>`, inline: true },
      { name: '💬 內容', value: message },
      { name: '⏰ 提醒時間', value: formatTaipeiTime(remindAt) },
    )
    .setColor(color)
    .setFooter({ text: `ID: ${footerId}` });
}

// 週期提醒清單標示的「還剩 N 次」是含本場（即將發生的這場）的剩餘場次數，不是本場之後還剩幾次
function buildRemainingSuffix(recurrence, eventDate) {
  const remaining = computeRemainingOccurrences(recurrence, eventDate);
  return remaining === null ? '' : `（還剩${remaining}次）`;
}

function reminderToField(r) {
  const remindTime = formatTaipeiTime(r.remindAt);
  const recurrencePrefix = r.recurrence
    ? `${buildRecurrenceLabel(r.recurrence, r.eventDate)}${buildRemainingSuffix(r.recurrence, r.eventDate)}　`
    : '';
  return {
    name: `${recurrencePrefix}📅 事件：${buildEventDateDisplay(r.eventDate, r.eventTime)}　⏰ 提醒：${remindTime}`,
    value: `💬 ${r.message}\n📍 <#${r.channelId}>\n🆔 \`${r.id}\`\n​`,
  };
}

function truncateList(lines, limit = 1000) {
  const joined = lines.join('\n');
  if (joined.length <= limit) return joined;
  let result = '';
  let shown = 0;
  for (const line of lines) {
    const candidate = result ? `${result}\n${line}` : line;
    if (candidate.length > limit - 20) break;
    result = candidate;
    shown++;
  }
  return `${result}\n…等 ${lines.length - shown} 筆`;
}

module.exports = {
  maxEmbedFields,
  maxRemindersList,
  generateReminderId,
  buildReminderRecord,
  buildNextOccurrence,
  buildRecurrenceLabel,
  computeRemainingOccurrences,
  isDuplicate,
  buildEventDateDisplay,
  buildReminderResultEmbed,
  reminderToField,
  truncateList,
};
