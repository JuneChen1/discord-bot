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

const {
  toMinutes,
  formatEventDate,
  formatTaipeiTime,
  parseCSVLine,
  parseRemindTime,
  calcReminderTime,
  filterRemindersByRange,
  validateReminderInput,
  isDuplicateReminder,
  applyReminderEdits,
} = require('./utils');

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

// ── 提醒功能 ──────────────────────────────────────────────

const DATA_DIR = process.env.DATA_DIR || __dirname;
const REMINDERS_FILE = path.join(DATA_DIR, 'reminders.json');

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

function saveReminders(reminders) {
  fs.writeFileSync(REMINDERS_FILE, JSON.stringify(reminders, null, 2), 'utf8');
}

// setTimeout 最大值約 24.8 天，超過需分段遞迴
const MAX_TIMEOUT_MS = 2147483647;

// reminder.id -> timer handle，用於取消
const activeTimers = new Map();

// 排程觸發（內部呼叫，非使用者指令）
async function fireReminder(reminder) {
  activeTimers.delete(reminder.id);
  saveReminders(loadReminders().filter(r => r.id !== reminder.id));
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

function getTargetChannel(interaction) {
  return (process.env.REMINDER_CHANNEL_ID
    ? client.channels.cache.get(process.env.REMINDER_CHANNEL_ID)
    : null) ?? interaction.channel;
}

function reminderToField(r) {
  const eventDate = r.eventDate ? formatEventDate(r.eventDate) : '未知';
  const remindTime = formatTaipeiTime(r.remindAt);
  const eventTimeDisplay = r.eventTime ? `　🕐 ${r.eventTime}` : '';
  return {
    name: `📅 事件：${eventDate}${eventTimeDisplay}　⏰ 提醒：${remindTime}`,
    value: `💬 ${r.message}\n📍 <#${r.channelId}>\n🆔 \`${r.id}\`\n​`,
  };
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
    .setName('reminders-range')
    .setDescription('查看指定事件日期區間內的提醒')
    .addStringOption((opt) =>
      opt.setName('from').setDescription('起始日期，格式 YYYYMMDD，例如 20260601').setRequired(true)
    )
    .addStringOption((opt) =>
      opt.setName('to').setDescription('結束日期，格式 YYYYMMDD，例如 20260630（不填則只查 from 當天）').setRequired(false)
    )
    .toJSON(),

  new SlashCommandBuilder()
    .setName('remind-edit')
    .setDescription('透過 ID 編輯已設定的提醒（至少修改一個欄位）')
    .addStringOption((opt) =>
      opt.setName('id').setDescription('提醒 ID（可從 /reminders 查詢）').setRequired(true)
    )
    .addStringOption((opt) =>
      opt.setName('message').setDescription('新的提醒內容').setRequired(false)
    )
    .addStringOption((opt) =>
      opt.setName('date').setDescription('新的事件日期，格式 YYYYMMDD').setRequired(false)
    )
    .addStringOption((opt) =>
      opt.setName('time').setDescription('新的事件時間，格式 HH:MM').setRequired(false)
    )
    .addStringOption((opt) =>
      opt.setName('remind_date').setDescription('新的提醒日期，格式 YYYYMMDD').setRequired(false)
    )
    .addStringOption((opt) =>
      opt.setName('remind_time').setDescription('新的提醒時間，格式 HH:MM').setRequired(false)
    )
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
  try {
    await rest.put(Routes.applicationCommands(client.user.id), { body: commandDefs });
  } catch (err) {
    console.error('指令註冊失敗：', err);
    process.exit(1);
  }
  console.log(`Bot 已上線：${client.user.tag}`);
  console.log('已註冊指令：remind, reminders, reminders-range, remind-edit, remind-delete, remind-import, help');

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

async function handleInteraction(interaction) {
  const userId = interaction.user.id;
  const cmd = interaction.commandName;

  // ── /remind ──────────────────────────────────────────────
  if (cmd === 'remind') {
    const dateStr = interaction.options.getString('date');
    const message = interaction.options.getString('message');
    const timeStr = interaction.options.getString('time') ?? '';
    const remindTimeStr = interaction.options.getString('remind_time') ?? '';
    const remindDateStr = interaction.options.getString('remind_date') ?? '';
    const targetChannel = getTargetChannel(interaction);

    const validated = validateReminderInput({ dateStr, timeStr, remindDateStr, remindTimeRaw: remindTimeStr });
    if (validated.error) {
      await interaction.reply({ content: validated.error, flags: MessageFlags.Ephemeral });
      return;
    }
    const { remindTimeDisplay, remindAt } = validated;

    const reminders = loadReminders();

    const duplicate = isDuplicateReminder(reminders, { userId, eventDate: dateStr, eventTime: timeStr, message, remindTime: remindTimeDisplay, remindDate: remindDateStr });
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

    const sorted = reminders.sort((a, b) => a.eventDate.localeCompare(b.eventDate));
    const embed = new EmbedBuilder()
      .setTitle('📋 你的提醒清單')
      .setColor(0x5865f2);

    for (const r of sorted) {
      embed.addFields(reminderToField(r));
    }

    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    return;
  }

  // ── /reminders-range ─────────────────────────────────────
  if (cmd === 'reminders-range') {
    const fromStr = interaction.options.getString('from').trim();
    const toStr = (interaction.options.getString('to') ?? '').trim() || fromStr;

    if (!/^\d{8}$/.test(fromStr) || !/^\d{8}$/.test(toStr)) {
      await interaction.reply({ content: '❌ 日期格式錯誤，請使用 YYYYMMDD（例如 20260601）。', flags: MessageFlags.Ephemeral });
      return;
    }
    if (fromStr > toStr) {
      await interaction.reply({ content: '❌ 起始日期不可晚於結束日期。', flags: MessageFlags.Ephemeral });
      return;
    }

    const rangeLabel = fromStr === toStr ? formatEventDate(fromStr) : `${formatEventDate(fromStr)} ～ ${formatEventDate(toStr)}`;
    const inRange = filterRemindersByRange(loadReminders(), userId, fromStr, toStr);

    if (inRange.length === 0) {
      await interaction.reply({ content: `📭 ${rangeLabel} 沒有任何提醒。`, flags: MessageFlags.Ephemeral });
      return;
    }
    const embed = new EmbedBuilder()
      .setTitle(`📋 提醒清單（${rangeLabel}）`)
      .setColor(0x5865f2);

    for (const r of inRange) {
      embed.addFields(reminderToField(r));
    }

    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    return;
  }

  // ── /remind-edit ─────────────────────────────────────────
  if (cmd === 'remind-edit') {
    const targetId = interaction.options.getString('id').trim();
    const newMessage = interaction.options.getString('message');
    const newDateStr = interaction.options.getString('date');
    const newTimeStr = interaction.options.getString('time');
    const newRemindDateStr = interaction.options.getString('remind_date');
    const newRemindTimeStr = interaction.options.getString('remind_time');

    if (newMessage === null && newDateStr === null && newTimeStr === null && newRemindDateStr === null && newRemindTimeStr === null) {
      await interaction.reply({
        content: '❌ 請至少提供一個要修改的欄位（message、date、time、remind_date、remind_time）。',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const reminders = loadReminders();
    const idx = reminders.findIndex(r => r.id === targetId);

    if (idx === -1) {
      await interaction.reply({
        content: `❌ 找不到 ID 為 \`${targetId}\` 的提醒。`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const existing = reminders[idx];

    if (existing.userId !== userId) {
      await interaction.reply({
        content: '❌ 你只能編輯自己的提醒。',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const patches = {};
    if (newDateStr !== null) patches.date = newDateStr;
    if (newMessage !== null) patches.message = newMessage;
    if (newTimeStr !== null) patches.time = newTimeStr;
    if (newRemindDateStr !== null) patches.remindDate = newRemindDateStr;
    if (newRemindTimeStr !== null) patches.remindTime = newRemindTimeStr;

    const { dateStr, message, timeStr, remindDateStr, remindTimeRaw } = applyReminderEdits(existing, patches);

    const validated = validateReminderInput({ dateStr, timeStr, remindDateStr, remindTimeRaw });
    if (validated.error) {
      await interaction.reply({ content: validated.error, flags: MessageFlags.Ephemeral });
      return;
    }
    const { remindTimeDisplay, remindAt } = validated;

    const otherReminders = reminders.filter(r => r.id !== targetId);
    if (isDuplicateReminder(otherReminders, { userId, eventDate: dateStr, eventTime: timeStr, message, remindTime: remindTimeDisplay, remindDate: remindDateStr })) {
      await interaction.reply({
        content: `❌ 你在 \`${formatEventDate(dateStr)}${timeStr ? ` ${timeStr}` : ''}\` 已有相同內容的提醒：「${message}」`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    cancelReminder(targetId);

    const updated = {
      ...existing,
      message,
      eventDate: dateStr,
      eventTime: timeStr,
      remindTime: remindTimeDisplay,
      remindAt,
    };
    if (remindDateStr) {
      updated.remindDate = remindDateStr;
    } else {
      delete updated.remindDate;
    }

    reminders[idx] = updated;
    saveReminders(reminders);
    scheduleReminder(updated);

    const eventDateFormatted = formatEventDate(dateStr);
    const eventDateDisplay = timeStr ? `${eventDateFormatted}　🕐 ${timeStr}` : eventDateFormatted;
    const embed = new EmbedBuilder()
      .setTitle('✏️ 提醒已更新')
      .addFields(
        { name: '📅 事件日期', value: eventDateDisplay, inline: true },
        { name: '📍 頻道', value: `<#${existing.channelId}>`, inline: true },
        { name: '💬 內容', value: message },
        { name: '⏰ 提醒時間', value: formatTaipeiTime(remindAt) }
      )
      .setColor(0x5865f2)
      .setFooter({ text: `ID: ${targetId}` });

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
      const idx = reminders.findIndex(r => r.id === targetId);
      if (idx === -1) {
        failed.push(`\`${targetId}\`：找不到此 ID，多個 ID 請用空白隔開`);
        continue;
      }
      const target = reminders[idx];
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
      reminders.splice(idx, 1);
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

    const targetChannel = getTargetChannel(interaction);

    const success = [];
    const failed = [];
    const reminders = loadReminders();
    const now = Date.now();

    for (let i = 0; i < dataLines.length; i++) {
      const fields = parseCSVLine(dataLines[i]);
      if (fields === null) {
        failed.push(`第 ${i + 1} 行：CSV 格式錯誤（引號未關閉）`);
        continue;
      }
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

      const isDuplicate = isDuplicateReminder(reminders, { userId, eventDate: dateStr, eventTime: timeStr, message, remindTime: remindTimeDisplay, remindDate: remindDateRaw });
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
          value: '設定提醒，將在指定日期的指定時間發送\n`date` 事件日期（YYYYMMDD）、`message` 提醒內容、`time` 事件時間（HH:MM，選填）、`remind_time`提醒時間（HH:MM，預設 22:00）、`remind_date` 提醒日期（YYYYMMDD，預設前一天）\n​',
        },
        {
          name: '/reminders',
          value: '查看你所有待發送的提醒\n​',
        },
        {
          name: '/reminders-range',
          value: '查看指定事件日期區間內的提醒\n`from` 起始日期（YYYYMMDD，必填）、`to` 結束日期（YYYYMMDD，不填則只查 from 當天）\n​',
        },
        {
          name: '/remind-edit',
          value: '透過 ID 編輯已設定的提醒，未填寫的欄位將保留原有值\n`id` 提醒 ID（必填）、`message` 新內容、`date` 新事件日期（YYYYMMDD）、`time` 新事件時間（HH:MM）、`remind_date` 新提醒日期（YYYYMMDD）、`remind_time`、新提醒時間（HH:MM）\n​',
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
}

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  try {
    await handleInteraction(interaction);
  } catch (err) {
    console.error(`[${interaction.commandName}] 未預期錯誤：`, err);
    const payload = { content: '❌ 發生未預期的錯誤，請稍後再試。', flags: MessageFlags.Ephemeral };
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply(payload).catch(() => {});
    } else {
      await interaction.reply(payload).catch(() => {});
    }
  }
});

client.login(process.env.DISCORD_TOKEN);
