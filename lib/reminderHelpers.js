const { EmbedBuilder } = require('discord.js');
const { formatEventDate, formatTaipeiTime, isDuplicateReminder } = require('./utils');

const maxEmbedFields = 25;

// reminder.id 產生規則：userId-時間戳-(批次序號-)隨機字串；suffix 用於同批次匯入避免碰撞
function generateReminderId(userId, suffix) {
  const suffixPart = suffix !== undefined ? `${suffix}-` : '';
  const random = Math.random().toString(36).slice(2);
  return `${userId}-${Date.now()}-${suffixPart}${random}`;
}

// 組出儲存於 reminders.json 的提醒物件；remindDate 為空時不寫入該欄位
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
  return record;
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

function reminderToField(r) {
  const remindTime = formatTaipeiTime(r.remindAt);
  return {
    name: `📅 事件：${buildEventDateDisplay(r.eventDate, r.eventTime)}　⏰ 提醒：${remindTime}`,
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
  generateReminderId,
  buildReminderRecord,
  isDuplicate,
  buildEventDateDisplay,
  buildReminderResultEmbed,
  reminderToField,
  truncateList,
};
