const { buildEventDateDisplay, buildRecurrenceLabel, computeRemainingOccurrences } = require('./reminderHelpers');
const { formatTaipeiTime } = require('./utils');

const htmlEscapes = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (ch) => htmlEscapes[ch]);
}

// 週期提醒標示，格式同 Discord embed 版（reminderToField），但輸出為純文字供 HTML escape
function recurrencePrefix(r) {
  if (!r.recurrence) return '';
  const remaining = computeRemainingOccurrences(r.recurrence, r.eventDate);
  const label = buildRecurrenceLabel(r.recurrence, r.eventDate);
  return remaining === null ? `${label}　` : `${label}（還剩${remaining}次）　`;
}

function reminderToListItem(r) {
  const title = `${recurrencePrefix(r)}📅 ${buildEventDateDisplay(r.eventDate, r.eventTime)}　⏰ ${formatTaipeiTime(r.remindAt)}`;
  return `<li class="reminder">
    <div class="title">${escapeHtml(title)}</div>
    <div class="message">💬 ${escapeHtml(r.message)}</div>
  </li>`;
}

// 產生唯讀提醒清單頁面；reminders 需先由呼叫端過濾為單一使用者
function renderRemindersPage(reminders, userName) {
  const sorted = [...reminders].sort((a, b) => a.eventDate.localeCompare(b.eventDate));
  const items = sorted.length
    ? sorted.map(reminderToListItem).join('\n')
    : '<p class="empty">目前沒有任何待發送的提醒。</p>';
  const title = userName ? `${escapeHtml(userName)} 的提醒清單` : '我的提醒清單';

  return `<!DOCTYPE html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${title}</title>
<style>
  body { font-family: -apple-system, "Segoe UI", "PingFang TC", "Microsoft JhengHei", sans-serif; background: #f5f6fa; color: #2c2f33; margin: 0; padding: 24px; }
  .container { max-width: 50%; margin: 0 auto; }
  @media (max-width: 700px) { .container { max-width: 100%; } }
  h1 { font-size: 20px; }
  ul { list-style: none; padding: 0; margin: 0; }
  .reminder { background: #fff; border-radius: 8px; padding: 12px 16px; margin-bottom: 10px; box-shadow: 0 1px 2px rgba(0,0,0,0.08); }
  .title { font-weight: 600; margin-bottom: 4px; }
  .message { white-space: pre-wrap; color: #444; }
  .empty { color: #888; }
</style>
</head>
<body>
<div class="container">
<h1>📋 ${title}</h1>
<ul>
${items}
</ul>
</div>
</body>
</html>`;
}

module.exports = { renderRemindersPage };
