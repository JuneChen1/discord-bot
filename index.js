const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  EmbedBuilder,
  MessageFlags,
} = require('discord.js');
const fs = require('fs');
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '.env') });

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

// ── 日期／時間格式化 ──────────────────────────────────────

// /remind、/remind-import
// "HH:MM" → 分鐘數（用於時間大小比較，避免字串比較的前導零問題）
function toMinutes(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

// /remind、/remind-delete、/remind-import
// YYYYMMDD → YYYY/MM/DD
function formatEventDate(dateStr) {
  return `${dateStr.slice(0, 4)}/${dateStr.slice(4, 6)}/${dateStr.slice(6, 8)}`;
}

// /remind、/reminders
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

// ── CSV 解析 ──────────────────────────────────────────────

// /remind-import
// 支援帶引號的欄位（欄位內含逗號時用雙引號包圍）
function parseCSVLine(line) {
  const fields = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      fields.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  fields.push(current);
  return fields;
}

// ── 提醒功能 ──────────────────────────────────────────────

const DATA_DIR = process.env.DATA_DIR || __dirname;
const REMINDERS_FILE = path.join(DATA_DIR, 'reminders.json');

// 啟動時、/remind、/reminders、/remind-delete、/remind-import
function loadReminders() {
  if (fs.existsSync(REMINDERS_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(REMINDERS_FILE, 'utf8'));
    } catch {
      return [];
    }
  }
  return [];
}

// /remind、/remind-delete、/remind-import、提醒觸發後（fireReminder）
function saveReminders(reminders) {
  fs.writeFileSync(REMINDERS_FILE, JSON.stringify(reminders, null, 2), 'utf8');
}

const DEFAULT_REMIND_HOUR = 22;
const DEFAULT_REMIND_MINUTE = 0;

// /remind、/remind-import
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

// /remind、/remind-import
// 給定事件日期與提醒時間，回傳指定提醒日期（預設前一天）指定時間（台灣時間 UTC+8）的 UTC timestamp (ms)
function calcReminderTime(eventDateStr, remindHour = DEFAULT_REMIND_HOUR, remindMinute = DEFAULT_REMIND_MINUTE, remindDateStr = null) {
  if (!/^\d{8}$/.test(eventDateStr)) return null;
  let remindDay;
  if (remindDateStr) {
    if (!/^\d{8}$/.test(remindDateStr)) return null;
    const ry = Number(remindDateStr.slice(0, 4));
    const rm = Number(remindDateStr.slice(4, 6));
    const rd = Number(remindDateStr.slice(6, 8));
    remindDay = new Date(Date.UTC(ry, rm - 1, rd));
    if (isNaN(remindDay)) return null;
  } else {
    const y = Number(eventDateStr.slice(0, 4));
    const m = Number(eventDateStr.slice(4, 6));
    const d = Number(eventDateStr.slice(6, 8));
    const eventDate = new Date(Date.UTC(y, m - 1, d));
    if (isNaN(eventDate)) return null;
    remindDay = new Date(eventDate);
    remindDay.setUTCDate(remindDay.getUTCDate() - 1);
  }
  // remindHour:remindMinute 台灣時間 UTC+8 → UTC
  remindDay.setUTCHours(remindHour - 8, remindMinute, 0, 0);
  return remindDay.getTime();
}

// setTimeout 最大值約 24.8 天，超過需分段遞迴
const MAX_TIMEOUT_MS = 2147483647;

// reminder.id -> timer handle，用於取消
const activeTimers = new Map();

// 排程觸發（內部呼叫，非使用者指令）
async function fireReminder(reminder) {
  activeTimers.delete(reminder.id);
  const channel = client.channels.cache.get(reminder.channelId);
  if (channel) {
    const embed = new EmbedBuilder()
      .setTitle('⏰ 提醒')
      .setDescription(reminder.message)
      .setColor(0x5865f2)
      .setFooter({ text: `由 ${reminder.userName} 設定` })
      .setTimestamp();
    await channel.send({ content: `<@${reminder.userId}>`, embeds: [embed] }).catch(() => {});
  }
  saveReminders(loadReminders().filter(r => r.id !== reminder.id));
}

// 啟動時、/remind、/remind-import
function scheduleReminder(reminder) {
  const delay = reminder.remindAt - Date.now();
  if (delay <= 0) return;
  const wait = Math.min(delay, MAX_TIMEOUT_MS);
  const handle = setTimeout(() => {
    if (wait < delay) {
      scheduleReminder(reminder);
    } else {
      fireReminder(reminder);
    }
  }, wait);
  activeTimers.set(reminder.id, handle);
}

// /remind-delete
function cancelReminder(reminderId) {
  const handle = activeTimers.get(reminderId);
  if (handle !== undefined) {
    clearTimeout(handle);
    activeTimers.delete(reminderId);
  }
}

// ─────────────────────────────────────────────────────────

const commandDefs = [
  new SlashCommandBuilder()
    .setName('remind')
    .setDescription('設定提醒，將在指定日期（預設事件前一天）的指定時間（預設 22:00 台灣時間）發送')
    .addStringOption((opt) =>
      opt.setName('date').setDescription('事件日期，格式 YYYYMMDD，例如 20260510').setRequired(true)
    )
    .addStringOption((opt) =>
      opt.setName('message').setDescription('提醒內容').setRequired(true)
    )
    .addStringOption((opt) =>
      opt.setName('time').setDescription('事件時間，格式 HH:MM，例如 14:30').setRequired(false)
    )
    .addStringOption((opt) =>
      opt.setName('remind_date').setDescription('提醒日期，格式 YYYYMMDD，預設為事件前一天').setRequired(false)
    )
    .addStringOption((opt) =>
      opt.setName('remind_time').setDescription('提醒時間，格式 HH:MM，預設 22:00（台灣時間）').setRequired(false)
    )
    .toJSON(),

  new SlashCommandBuilder()
    .setName('reminders')
    .setDescription('查看你所有待發送的提醒')
    .toJSON(),

  new SlashCommandBuilder()
    .setName('remind-delete')
    .setDescription('刪除待發送的提醒，支援多個 ID（空白隔開）')
    .addStringOption((opt) =>
      opt.setName('id').setDescription('提醒 ID，多個用空白隔開（ID 可從建立時的訊息底部或 /reminders 查詢）').setRequired(true)
    )
    .toJSON(),

  new SlashCommandBuilder()
    .setName('remind-import')
    .setDescription('從 CSV 檔案批次匯入提醒')
    .addAttachmentOption((opt) =>
      opt.setName('file').setDescription('CSV 檔案（欄位：date, message, time, remind_time, remind_date）').setRequired(true)
    )
    .toJSON(),

  new SlashCommandBuilder()
    .setName('help')
    .setDescription('查看所有可用指令')
    .toJSON(),
];

client.once('clientReady', async () => {
  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  await rest.put(Routes.applicationCommands(client.user.id), { body: commandDefs });
  console.log(`Bot 已上線：${client.user.tag}`);
  console.log('已註冊指令：remind, reminders, remind-delete, remind-import, help');

  // 載入並排程所有已存在的提醒，過期的直接刪除
  const reminders = loadReminders();
  const now = Date.now();
  const expired = reminders.filter(r => r.remindAt <= now);
  const valid = reminders.filter(r => r.remindAt > now);
  if (expired.length > 0) {
    saveReminders(valid);
    console.log(`已刪除 ${expired.length} 個過期提醒：${expired.map(r => r.message).join(', ')}`);
  }
  valid.forEach(scheduleReminder);
  console.log(`已排程 ${valid.length} 個提醒`);
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const userId = interaction.user.id;
  const cmd = interaction.commandName;

  // ── /remind ──────────────────────────────────────────────
  if (cmd === 'remind') {
    const dateStr = interaction.options.getString('date');
    const message = interaction.options.getString('message');
    const timeStr = interaction.options.getString('time') ?? '';
    const remindTimeStr = interaction.options.getString('remind_time') ?? '';
    const remindDateStr = interaction.options.getString('remind_date') ?? '';
    const targetChannel =
      (process.env.REMINDER_CHANNEL_ID
        ? client.channels.cache.get(process.env.REMINDER_CHANNEL_ID)
        : null) ??
      interaction.channel;

    const parsedRemindTime = parseRemindTime(remindTimeStr || null);
    if (!parsedRemindTime) {
      await interaction.reply({
        content: '❌ 提醒時間格式錯誤！請使用 `HH:MM`，例如 `18:30`。',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (remindDateStr && !/^\d{8}$/.test(remindDateStr)) {
      await interaction.reply({
        content: '❌ 提醒日期格式錯誤！請使用 `YYYYMMDD`，例如 `20260509`。',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (remindDateStr && remindDateStr > dateStr) {
      await interaction.reply({
        content: `❌ 提醒日期（\`${formatEventDate(remindDateStr)}\`）不能晚於事件日期（\`${formatEventDate(dateStr)}\`）！`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const remindAt = calcReminderTime(dateStr, parsedRemindTime.hour, parsedRemindTime.minute, remindDateStr || null);

    if (!remindAt) {
      await interaction.reply({
        content: '❌ 日期格式錯誤！請使用 `YYYYMMDD`，例如 `20260510`。',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const remindTimeDisplay = `${String(parsedRemindTime.hour).padStart(2, '0')}:${String(parsedRemindTime.minute).padStart(2, '0')}`;

    if (remindDateStr && remindDateStr === dateStr && timeStr && toMinutes(remindTimeDisplay) >= toMinutes(timeStr)) {
      await interaction.reply({
        content: `❌ 提醒日期與事件同天（\`${formatEventDate(dateStr)}\`），提醒時間（\`${remindTimeDisplay}\`）不能晚於或等於事件時間（\`${timeStr}\`）！`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (remindAt <= Date.now()) {
      const remindAtDisplay = formatTaipeiTime(remindAt);
      await interaction.reply({
        content: `❌ 提醒時間 ${remindAtDisplay} 已過，無法設定提醒！請調整事件日期或提醒時間。`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const reminders = loadReminders();

    const duplicate = reminders.find(r => r.userId === userId && r.eventDate === dateStr && r.eventTime === timeStr && r.message === message && r.remindTime === remindTimeDisplay && (r.remindDate ?? '') === remindDateStr);
    if (duplicate) {
      await interaction.reply({
        content: `❌ 你在 \`${formatEventDate(dateStr)}${timeStr ? ` ${timeStr}` : ''}\` 已有相同內容的提醒：「${message}」`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const id = `${userId}-${Date.now()}`;
    const reminder = {
      id,
      userId,
      userName: interaction.user.username,
      channelId: targetChannel.id,
      message,
      eventDate: dateStr,
      eventTime: timeStr,
      remindTime: remindTimeDisplay,
      ...(remindDateStr ? { remindDate: remindDateStr } : {}),
      remindAt,
    };

    reminders.push(reminder);
    saveReminders(reminders);
    scheduleReminder(reminder);

    const displayRemindTime = formatTaipeiTime(remindAt);

    const eventDateFormatted = formatEventDate(dateStr);
    const eventDateDisplay = timeStr ? `${eventDateFormatted}　🕐 ${timeStr}` : eventDateFormatted;
    const embed = new EmbedBuilder()
      .setTitle('✅ 提醒已設定')
      .addFields(
        { name: '📅 事件日期', value: eventDateDisplay, inline: true },
        { name: '📍 頻道', value: `<#${targetChannel.id}>`, inline: true },
        { name: '💬 內容', value: message },
        { name: '⏰ 提醒時間', value: displayRemindTime }
      )
      .setColor(0x57f287)
      .setFooter({ text: `ID: ${id}` });

    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    return;
  }

  // ── /reminders ───────────────────────────────────────────
  if (cmd === 'reminders') {
    const reminders = loadReminders().filter(r => r.userId === userId);

    if (reminders.length === 0) {
      await interaction.reply({ content: '📭 你目前沒有任何待發送的提醒。', flags: MessageFlags.Ephemeral });
      return;
    }

    const sorted = reminders.sort((a, b) => a.remindAt - b.remindAt);
    const embed = new EmbedBuilder()
      .setTitle('📋 你的提醒清單')
      .setColor(0x5865f2);

    for (const r of sorted) {
      const rawDate = r.eventDate;
      const eventDate = rawDate ? formatEventDate(rawDate) : '未知';
      const remindTime = formatTaipeiTime(r.remindAt);
      const eventTimeDisplay = r.eventTime ? `　🕐 ${r.eventTime}` : '';
      embed.addFields({
        name: `📅 事件：${eventDate}${eventTimeDisplay}　⏰ 提醒：${remindTime}`,
        value: `💬 ${r.message}\n📍 <#${r.channelId}>\n🆔 \`${r.id}\`\n​`,
      });
    }

    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    return;
  }

  // ── /remind-delete ────────────────────────────────────────
  if (cmd === 'remind-delete') {
    const ids = interaction.options.getString('id').trim().split(/\s+/);
    const reminders = loadReminders();
    const deleted = [];
    const failed = [];

    for (const targetId of ids) {
      const target = reminders.find(r => r.id === targetId);
      if (!target) {
        failed.push(`\`${targetId}\`：找不到此 ID，多個 ID 請用空白隔開`);
        continue;
      }
      if (target.userId !== userId) {
        failed.push(`\`${targetId}\`：你只能刪除自己的提醒`);
        continue;
      }
      cancelReminder(targetId);
      const formattedDeleteDate = target.eventDate ? formatEventDate(target.eventDate) : '未知';
      const dateDisplay = target.eventTime
        ? `${formattedDeleteDate}　🕐 ${target.eventTime}`
        : formattedDeleteDate;
      deleted.push(`📅 ${dateDisplay}　💬 ${target.message}`);
      reminders.splice(reminders.indexOf(target), 1);
    }

    saveReminders(reminders);

    const color = failed.length === 0 ? 0x57f287 : deleted.length === 0 ? 0xed4245 : 0xfee75c;
    const embed = new EmbedBuilder()
      .setTitle('🗑️ 刪除結果')
      .setColor(color);

    if (deleted.length > 0) {
      embed.addFields({ name: `✅ 已刪除 ${deleted.length} 筆`, value: deleted.join('\n') });
    }
    if (failed.length > 0) {
      embed.addFields({ name: `❌ 失敗 ${failed.length} 筆`, value: failed.join('\n') });
    }

    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    return;
  }

  // ── /remind-import ───────────────────────────────────────
  if (cmd === 'remind-import') {
    const attachment = interaction.options.getAttachment('file');

    if (!attachment.name.endsWith('.csv')) {
      await interaction.reply({
        content: '❌ 請上傳 `.csv` 格式的檔案。',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    let text;
    try {
      const res = await fetch(attachment.url);
      text = await res.text();
    } catch {
      await interaction.editReply('❌ 無法讀取檔案，請稍後再試。');
      return;
    }

    // 去掉 UTF-8 BOM（Excel 存出的 CSV 會帶這個）
    text = text.replace(/^﻿/, '');
    const lines = text.split(/\r?\n/).map(l => l.trim()).filter(l => l);
    if (lines.length === 0) {
      await interaction.editReply('❌ CSV 檔案是空的。');
      return;
    }

    // 若第一行是 header 則跳過
    const dataLines = lines[0].toLowerCase().startsWith('date') ? lines.slice(1) : lines;
    if (dataLines.length === 0) {
      await interaction.editReply('❌ CSV 只有 header，沒有資料列。');
      return;
    }

    const targetChannel =
      (process.env.REMINDER_CHANNEL_ID
        ? client.channels.cache.get(process.env.REMINDER_CHANNEL_ID)
        : null) ??
      interaction.channel;

    const success = [];
    const failed = [];
    const reminders = loadReminders();
    const now = Date.now();

    for (let i = 0; i < dataLines.length; i++) {
      const fields = parseCSVLine(dataLines[i]);
      const dateStr = (fields[0] ?? '').trim();
      const message = (fields[1] ?? '').trim();
      const timeStr = (fields[2] ?? '').trim();
      const remindTimeRaw = (fields[3] ?? '').trim();
      const remindDateRaw = (fields[4] ?? '').trim();

      if (!dateStr || !message) {
        failed.push(`第 ${i + 1} 行：缺少必要欄位（date 或 message）`);
        continue;
      }

      const parsedRemindTime = parseRemindTime(remindTimeRaw || null);
      if (!parsedRemindTime) {
        failed.push(`第 ${i + 1} 行：remind_time 格式錯誤（\`${remindTimeRaw}\`），請使用 HH:MM`);
        continue;
      }

      if (remindDateRaw && !/^\d{8}$/.test(remindDateRaw)) {
        failed.push(`第 ${i + 1} 行：remind_date 格式錯誤（\`${remindDateRaw}\`），請使用 YYYYMMDD`);
        continue;
      }

      if (remindDateRaw && remindDateRaw > dateStr) {
        failed.push(`第 ${i + 1} 行：提醒日期（\`${formatEventDate(remindDateRaw)}\`）不能晚於事件日期（\`${formatEventDate(dateStr)}\`）`);
        continue;
      }

      const remindTimeDisplay = `${String(parsedRemindTime.hour).padStart(2, '0')}:${String(parsedRemindTime.minute).padStart(2, '0')}`;

      if (remindDateRaw && remindDateRaw === dateStr && timeStr && toMinutes(remindTimeDisplay) >= toMinutes(timeStr)) {
        failed.push(`第 ${i + 1} 行：提醒日期與事件同天（\`${formatEventDate(dateStr)}\`），提醒時間（\`${remindTimeDisplay}\`）不能晚於或等於事件時間（\`${timeStr}\`）`);
        continue;
      }

      const remindAt = calcReminderTime(dateStr, parsedRemindTime.hour, parsedRemindTime.minute, remindDateRaw || null);
      if (!remindAt) {
        failed.push(`第 ${i + 1} 行：日期格式錯誤（\`${dateStr}\`）`);
        continue;
      }

      if (remindAt <= now) {
        failed.push(`第 ${i + 1} 行：提醒時間已過，無法設定（\`${formatEventDate(dateStr)}\`）`);
        continue;
      }

      const isDuplicate = reminders.some(r => r.userId === userId && r.eventDate === dateStr && r.eventTime === timeStr && r.message === message && r.remindTime === remindTimeDisplay && (r.remindDate ?? '') === remindDateRaw);
      if (isDuplicate) {
        failed.push(`第 ${i + 1} 行：\`${formatEventDate(dateStr)}${timeStr ? ` ${timeStr}` : ''}\` 已有相同提醒「${message}」`);
        continue;
      }

      const id = `${userId}-${Date.now()}-${i}`;
      const reminder = {
        id,
        userId,
        userName: interaction.user.username,
        channelId: targetChannel.id,
        message,
        eventDate: dateStr,
        eventTime: timeStr,
        remindTime: remindTimeDisplay,
        ...(remindDateRaw ? { remindDate: remindDateRaw } : {}),
        remindAt,
      };

      reminders.push(reminder);
      scheduleReminder(reminder);
      const eventDisplay = timeStr ? `${formatEventDate(dateStr)} ${timeStr}` : formatEventDate(dateStr);
      success.push(`\`${eventDisplay}\`　${message}`);
    }

    saveReminders(reminders);

    const color =
      failed.length === 0 ? 0x57f287 :
      success.length === 0 ? 0xed4245 :
      0xfee75c;

    const embed = new EmbedBuilder()
      .setTitle('📥 批次匯入結果')
      .setColor(color);

    if (success.length > 0) {
      embed.addFields({ name: `✅ 成功 ${success.length} 筆`, value: success.join('\n') });
    }
    if (failed.length > 0) {
      embed.addFields({ name: `❌ 失敗 ${failed.length} 筆`, value: failed.join('\n') });
    }

    await interaction.editReply({ embeds: [embed] });
    return;
  }

  // ── /help ─────────────────────────────────────────────────
  if (cmd === 'help') {
    const embed = new EmbedBuilder()
      .setTitle('📖 可用指令')
      .setColor(0x5865f2)
      .addFields(
        {
          name: '/remind',
          value: '設定提醒，將在指定日期（預設事件前一天）的指定時間發送（預設 22:00 台灣時間）\n`date` 事件日期（YYYYMMDD）　`message` 提醒內容　`time` 事件時間（HH:MM，選填）　`remind_time` 提醒時間（HH:MM，預設 22:00）　`remind_date` 提醒日期（YYYYMMDD，預設前一天）\n​',
        },
        {
          name: '/reminders',
          value: '查看你所有待發送的提醒\n​',
        },
        {
          name: '/remind-delete',
          value: '刪除待發送的提醒\n`id` 提醒 ID，多個用空白隔開\n​',
        },
        {
          name: '/remind-import',
          value: '從 CSV 檔案批次匯入提醒\n`file` CSV 附件（欄位：date, message, time, remind_time, remind_date）\n​',
        },
        {
          name: '/help',
          value: '查看所有可用指令',
        },
      );

    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    return;
  }
});

client.login(process.env.DISCORD_TOKEN);
