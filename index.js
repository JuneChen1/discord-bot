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

if (!process.env.DISCORD_TOKEN) {
  console.error('缺少環境變數 DISCORD_TOKEN');
  process.exit(1);
}

const {
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
} = require('./utils');

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

// ── 提醒功能 ──────────────────────────────────────────────

const DATA_DIR = process.env.DATA_DIR || __dirname;
const REMINDERS_FILE = path.join(DATA_DIR, 'reminders.json');
const USER_SETTINGS_FILE = path.join(DATA_DIR, 'user_settings.json');

async function loadReminders() {
  try {
    const data = await fs.promises.readFile(REMINDERS_FILE, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    if (err.code !== 'ENOENT') console.error('reminders.json 讀取失敗：', err);
    return [];
  }
}

async function saveReminders(reminders) {
  await fs.promises.writeFile(REMINDERS_FILE, JSON.stringify(reminders, null, 2), 'utf8');
}

// 以 null-prototype 物件儲存設定，避免動態 key（userId）觸發原型鏈相關問題
function toSettingsObject(parsed) {
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    return Object.assign(Object.create(null), parsed);
  }
  return Object.create(null);
}

async function loadUserSettings() {
  try {
    const data = await fs.promises.readFile(USER_SETTINGS_FILE, 'utf8');
    return toSettingsObject(JSON.parse(data));
  } catch (err) {
    if (err.code !== 'ENOENT') console.error('user_settings.json 讀取失敗：', err);
    return Object.create(null);
  }
}

async function saveUserSettings(settings) {
  await fs.promises.writeFile(USER_SETTINGS_FILE, JSON.stringify(settings, null, 2), 'utf8');
}

// 序列化同一檔案的「讀取→修改→寫入」流程，避免並發指令互相覆蓋對方的寫入
function createMutex() {
  let queue = Promise.resolve();
  return function withLock(fn) {
    const run = queue.then(fn, fn);
    queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };
}

const withReminderLock = createMutex();
const withUserSettingsLock = createMutex();

// setTimeout 最大值約 24.8 天，超過需分段遞迴
const MAX_TIMEOUT_MS = 2147483647;
const MAX_EMBED_FIELDS = 25;

// reminder.id -> timer handle，用於取消
const activeTimers = new Map();

// 排程觸發（內部呼叫，非使用者指令）
async function fireReminder(reminder) {
  try {
    activeTimers.delete(reminder.id);
    await withReminderLock(async () => {
      const reminders = await loadReminders();
      await saveReminders(reminders.filter((r) => r.id !== reminder.id));
    });
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
  } catch (err) {
    console.error(`[fireReminder] 提醒 ${reminder.id} 發送失敗：`, err);
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
  return (
    (process.env.REMINDER_CHANNEL_ID
      ? client.channels.cache.get(process.env.REMINDER_CHANNEL_ID)
      : null) ?? interaction.channel
  );
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
    .setDescription(
      '設定提醒，將在指定的日期與時間發送（預設時間可使用 /remind-default 查詢與設定）',
    )
    .addStringOption((opt) =>
      opt
        .setName('date')
        .setDescription('事件日期，格式 YYYYMMDD，例如 20260510')
        .setRequired(true),
    )
    .addStringOption((opt) => opt.setName('message').setDescription('提醒內容').setRequired(true))
    .addStringOption((opt) =>
      opt.setName('time').setDescription('事件時間，格式 HH:MM，例如 14:30').setRequired(false),
    )
    .addStringOption((opt) =>
      opt
        .setName('remind_date')
        .setDescription('提醒日期，格式 YYYYMMDD，預設為事件前一天')
        .setRequired(false),
    )
    .addStringOption((opt) =>
      opt
        .setName('remind_time')
        .setDescription('提醒時間，格式 HH:MM，預設為你的個人設定（見 /remind-default）')
        .setRequired(false),
    )
    .toJSON(),

  new SlashCommandBuilder()
    .setName('remind-default')
    .setDescription('查看或設定你的個人預設提醒時間（/remind 未指定 remind_time 時套用）')
    .addStringOption((opt) =>
      opt
        .setName('time')
        .setDescription('新的預設提醒時間，格式 HH:MM，例如 21:00')
        .setRequired(false),
    )
    .addBooleanOption((opt) =>
      opt.setName('reset').setDescription('重設為系統預設（22:00）').setRequired(false),
    )
    .toJSON(),

  new SlashCommandBuilder().setName('reminders').setDescription('查看你所有待發送的提醒').toJSON(),

  new SlashCommandBuilder()
    .setName('reminders-range')
    .setDescription('查看指定事件日期區間內的提醒')
    .addStringOption((opt) =>
      opt
        .setName('from')
        .setDescription('起始日期，格式 YYYYMMDD，例如 20260601')
        .setRequired(true),
    )
    .addStringOption((opt) =>
      opt
        .setName('to')
        .setDescription('結束日期，格式 YYYYMMDD，例如 20260630（不填則只查 from 當天）')
        .setRequired(false),
    )
    .toJSON(),

  new SlashCommandBuilder()
    .setName('remind-edit')
    .setDescription('透過 ID 編輯已設定的提醒（至少修改一個欄位）')
    .addStringOption((opt) =>
      opt.setName('id').setDescription('提醒 ID（可從 /reminders 查詢）').setRequired(true),
    )
    .addStringOption((opt) =>
      opt.setName('message').setDescription('新的提醒內容').setRequired(false),
    )
    .addStringOption((opt) =>
      opt.setName('date').setDescription('新的事件日期，格式 YYYYMMDD').setRequired(false),
    )
    .addStringOption((opt) =>
      opt.setName('time').setDescription('新的事件時間，格式 HH:MM').setRequired(false),
    )
    .addStringOption((opt) =>
      opt.setName('remind_date').setDescription('新的提醒日期，格式 YYYYMMDD').setRequired(false),
    )
    .addStringOption((opt) =>
      opt.setName('remind_time').setDescription('新的提醒時間，格式 HH:MM').setRequired(false),
    )
    .toJSON(),

  new SlashCommandBuilder()
    .setName('remind-delete')
    .setDescription('刪除待發送的提醒，支援多個 ID（空白隔開）')
    .addStringOption((opt) =>
      opt
        .setName('id')
        .setDescription('提醒 ID，多個用空白隔開（ID 可從建立時的訊息底部或 /reminders 查詢）')
        .setRequired(true),
    )
    .toJSON(),

  new SlashCommandBuilder()
    .setName('remind-import')
    .setDescription('從 CSV 檔案批次匯入提醒')
    .addAttachmentOption((opt) =>
      opt
        .setName('file')
        .setDescription('CSV 檔案（欄位：date, message, time, remind_time, remind_date）')
        .setRequired(true),
    )
    .toJSON(),

  new SlashCommandBuilder().setName('help').setDescription('查看所有可用指令').toJSON(),
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
  console.log(
    '已註冊指令：remind, remind-default, reminders, reminders-range, remind-edit, remind-delete, remind-import, help',
  );

  // 載入並排程所有已存在的提醒，過期的直接刪除
  const reminders = await loadReminders();
  const now = Date.now();
  const expired = reminders.filter((r) => r.remindAt <= now);
  const valid = reminders.filter((r) => r.remindAt > now);
  if (expired.length > 0) {
    await saveReminders(valid);
    console.log(`已刪除 ${expired.length} 個過期提醒：${expired.map((r) => r.message).join(', ')}`);
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

    // 只有在使用者沒有明確指定 remind_time 時才需要讀取個人預設設定
    const userDefault = remindTimeStr
      ? null
      : getUserRemindDefault(await loadUserSettings(), userId);

    const validated = validateReminderInput({
      dateStr,
      timeStr,
      remindDateStr,
      remindTimeRaw: remindTimeStr,
      defaultRemindHour: userDefault?.hour,
      defaultRemindMinute: userDefault?.minute,
    });
    if (validated.error) {
      await interaction.reply({ content: validated.error, flags: MessageFlags.Ephemeral });
      return;
    }
    const { remindTimeDisplay, remindAt } = validated;

    const outcome = await withReminderLock(async () => {
      const reminders = await loadReminders();

      const duplicate = isDuplicateReminder(reminders, {
        userId,
        eventDate: dateStr,
        eventTime: timeStr,
        message,
        remindTime: remindTimeDisplay,
        remindDate: remindDateStr,
      });
      if (duplicate) return { duplicate: true };

      const id = `${userId}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
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
      await saveReminders(reminders);
      return { reminder };
    });

    if (outcome.duplicate) {
      await interaction.reply({
        content: `❌ 你在 \`${formatEventDate(dateStr)}${timeStr ? ` ${timeStr}` : ''}\` 已有相同內容的提醒：「${message}」`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const { reminder } = outcome;
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
        { name: '⏰ 提醒時間', value: displayRemindTime },
      )
      .setColor(0x57f287)
      .setFooter({ text: `ID: ${reminder.id}` });

    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    return;
  }

  // ── /remind-default ──────────────────────────────────────
  if (cmd === 'remind-default') {
    const timeInput = (interaction.options.getString('time') ?? '').trim() || null;
    const reset = interaction.options.getBoolean('reset') ?? false;

    if (timeInput && reset) {
      await interaction.reply({
        content: '❌ `time` 和 `reset` 不能同時使用。',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (reset) {
      await withUserSettingsLock(async () => {
        const settings = await loadUserSettings();
        delete settings[userId];
        await saveUserSettings(settings);
      });
      await interaction.reply({
        content: `✅ 已重設為系統預設提醒時間：\`${String(DEFAULT_REMIND_HOUR).padStart(2, '0')}:${String(DEFAULT_REMIND_MINUTE).padStart(2, '0')}\`（台灣時間）。`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (timeInput) {
      const parsed = parseRemindTime(timeInput);
      if (!parsed) {
        await interaction.reply({
          content: '❌ 時間格式錯誤！請使用 `HH:MM`，例如 `21:00`。',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      const display = `${String(parsed.hour).padStart(2, '0')}:${String(parsed.minute).padStart(2, '0')}`;
      await withUserSettingsLock(async () => {
        const settings = await loadUserSettings();
        settings[userId] = { remindHour: parsed.hour, remindMinute: parsed.minute };
        await saveUserSettings(settings);
      });
      await interaction.reply({
        content: `✅ 你的個人預設提醒時間已設定為 \`${display}\`（台灣時間），\`/remind\` 未指定 \`remind_time\` 時將套用此設定。`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const settings = await loadUserSettings();
    const current = getUserRemindDefault(settings, userId);
    const display = `${String(current.hour).padStart(2, '0')}:${String(current.minute).padStart(2, '0')}`;
    const isCustom = Object.hasOwn(settings, userId);
    await interaction.reply({
      content: `⏰ 你目前的個人預設提醒時間：\`${display}\`（台灣時間）${isCustom ? '' : '　（尚未自訂，使用系統預設）'}`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // ── /reminders ───────────────────────────────────────────
  if (cmd === 'reminders') {
    const reminders = (await loadReminders()).filter((r) => r.userId === userId);

    if (reminders.length === 0) {
      await interaction.reply({
        content: '📭 你目前沒有任何待發送的提醒。',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const sorted = reminders.sort((a, b) => a.eventDate.localeCompare(b.eventDate));
    const shown = sorted.slice(0, MAX_EMBED_FIELDS);
    const overflow = sorted.length - shown.length;
    const embed = new EmbedBuilder().setTitle('📋 你的提醒清單').setColor(0x5865f2);

    for (const r of shown) {
      embed.addFields(reminderToField(r));
    }
    if (overflow > 0) {
      embed.setFooter({ text: `尚有 ${overflow} 筆未顯示` });
    }

    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    return;
  }

  // ── /reminders-range ─────────────────────────────────────
  if (cmd === 'reminders-range') {
    const fromStr = interaction.options.getString('from').trim();
    const toStr = (interaction.options.getString('to') ?? '').trim() || fromStr;

    if (!/^\d{8}$/.test(fromStr) || !/^\d{8}$/.test(toStr)) {
      await interaction.reply({
        content: '❌ 日期格式錯誤，請使用 YYYYMMDD（例如 20260601）。',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    if (fromStr > toStr) {
      await interaction.reply({
        content: '❌ 起始日期不可晚於結束日期。',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const rangeLabel =
      fromStr === toStr
        ? formatEventDate(fromStr)
        : `${formatEventDate(fromStr)} ～ ${formatEventDate(toStr)}`;
    const inRange = filterRemindersByRange(await loadReminders(), userId, fromStr, toStr);

    if (inRange.length === 0) {
      await interaction.reply({
        content: `📭 ${rangeLabel} 沒有任何提醒。`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const shown = inRange.slice(0, MAX_EMBED_FIELDS);
    const overflow = inRange.length - shown.length;
    const embed = new EmbedBuilder().setTitle(`📋 提醒清單（${rangeLabel}）`).setColor(0x5865f2);

    for (const r of shown) {
      embed.addFields(reminderToField(r));
    }
    if (overflow > 0) {
      embed.setFooter({ text: `尚有 ${overflow} 筆未顯示` });
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

    if (
      newMessage === null &&
      newDateStr === null &&
      newTimeStr === null &&
      newRemindDateStr === null &&
      newRemindTimeStr === null
    ) {
      await interaction.reply({
        content: '❌ 請至少提供一個要修改的欄位（message、date、time、remind_date、remind_time）。',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const outcome = await withReminderLock(async () => {
      const reminders = await loadReminders();
      const idx = reminders.findIndex((r) => r.id === targetId);

      if (idx === -1) return { error: 'not-found' };

      const existing = reminders[idx];

      if (existing.userId !== userId) return { error: 'forbidden' };

      const patches = {};
      if (newDateStr !== null) patches.date = newDateStr;
      if (newMessage !== null) patches.message = newMessage;
      if (newTimeStr !== null) patches.time = newTimeStr;
      if (newRemindDateStr !== null) patches.remindDate = newRemindDateStr;
      if (newRemindTimeStr !== null) patches.remindTime = newRemindTimeStr;

      const { dateStr, message, timeStr, remindDateStr, remindTimeRaw } = applyReminderEdits(
        existing,
        patches,
      );

      const validated = validateReminderInput({ dateStr, timeStr, remindDateStr, remindTimeRaw });
      if (validated.error) return { error: 'validation', message: validated.error };
      const { remindTimeDisplay, remindAt } = validated;

      const otherReminders = reminders.filter((r) => r.id !== targetId);
      if (
        isDuplicateReminder(otherReminders, {
          userId,
          eventDate: dateStr,
          eventTime: timeStr,
          message,
          remindTime: remindTimeDisplay,
          remindDate: remindDateStr,
        })
      ) {
        return { error: 'duplicate', dateStr, timeStr, message };
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
      await saveReminders(reminders);
      return { updated, existing };
    });

    if (outcome.error === 'not-found') {
      await interaction.reply({
        content: `❌ 找不到 ID 為 \`${targetId}\` 的提醒。`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    if (outcome.error === 'forbidden') {
      await interaction.reply({
        content: '❌ 你只能編輯自己的提醒。',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    if (outcome.error === 'validation') {
      await interaction.reply({ content: outcome.message, flags: MessageFlags.Ephemeral });
      return;
    }
    if (outcome.error === 'duplicate') {
      const { dateStr, timeStr, message } = outcome;
      await interaction.reply({
        content: `❌ 你在 \`${formatEventDate(dateStr)}${timeStr ? ` ${timeStr}` : ''}\` 已有相同內容的提醒：「${message}」`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const { updated, existing } = outcome;
    scheduleReminder(updated);

    const eventDateFormatted = formatEventDate(updated.eventDate);
    const eventDateDisplay = updated.eventTime
      ? `${eventDateFormatted}　🕐 ${updated.eventTime}`
      : eventDateFormatted;
    const embed = new EmbedBuilder()
      .setTitle('✏️ 提醒已更新')
      .addFields(
        { name: '📅 事件日期', value: eventDateDisplay, inline: true },
        { name: '📍 頻道', value: `<#${existing.channelId}>`, inline: true },
        { name: '💬 內容', value: updated.message },
        { name: '⏰ 提醒時間', value: formatTaipeiTime(updated.remindAt) },
      )
      .setColor(0x5865f2)
      .setFooter({ text: `ID: ${targetId}` });

    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    return;
  }

  // ── /remind-delete ────────────────────────────────────────
  if (cmd === 'remind-delete') {
    const ids = interaction.options.getString('id').trim().split(/\s+/);

    const { deleted, failed } = await withReminderLock(async () => {
      const reminders = await loadReminders();
      const deleted = [];
      const failed = [];

      for (const targetId of ids) {
        const idx = reminders.findIndex((r) => r.id === targetId);
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

      if (deleted.length > 0) {
        await saveReminders(reminders);
      }

      return { deleted, failed };
    });

    const color = failed.length === 0 ? 0x57f287 : deleted.length === 0 ? 0xed4245 : 0xfee75c;
    const embed = new EmbedBuilder().setTitle('🗑️ 刪除結果').setColor(color);

    if (deleted.length > 0) {
      embed.addFields({ name: `✅ 已刪除 ${deleted.length} 筆`, value: truncateList(deleted) });
    }
    if (failed.length > 0) {
      embed.addFields({ name: `❌ 失敗 ${failed.length} 筆`, value: truncateList(failed) });
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
    text = text.replace(/^\uFEFF/, '');
    const lines = text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l);
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

    // 個人預設提醒時間僅在有資料列缺少 remind_time 時才需要讀取
    let userDefault = null;
    const getUserDefault = async () => {
      if (!userDefault) userDefault = getUserRemindDefault(await loadUserSettings(), userId);
      return userDefault;
    };

    const { toSchedule } = await withReminderLock(async () => {
      const reminders = await loadReminders();
      const now = Date.now();
      const toSchedule = [];

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

        const defaults = remindTimeRaw ? null : await getUserDefault();
        const parsedRemindTime = parseRemindTime(
          remindTimeRaw || null,
          defaults?.hour,
          defaults?.minute,
        );
        if (!parsedRemindTime) {
          failed.push(`第 ${i + 1} 行：remind_time 格式錯誤（\`${remindTimeRaw}\`），請使用 HH:MM`);
          continue;
        }

        if (remindDateRaw && !/^\d{8}$/.test(remindDateRaw)) {
          failed.push(
            `第 ${i + 1} 行：remind_date 格式錯誤（\`${remindDateRaw}\`），請使用 YYYYMMDD`,
          );
          continue;
        }

        if (remindDateRaw && remindDateRaw > dateStr) {
          failed.push(
            `第 ${i + 1} 行：提醒日期（\`${formatEventDate(remindDateRaw)}\`）不能晚於事件日期（\`${formatEventDate(dateStr)}\`）`,
          );
          continue;
        }

        const remindTimeDisplay = `${String(parsedRemindTime.hour).padStart(2, '0')}:${String(parsedRemindTime.minute).padStart(2, '0')}`;

        if (
          remindDateRaw &&
          remindDateRaw === dateStr &&
          timeStr &&
          toMinutes(remindTimeDisplay) >= toMinutes(timeStr)
        ) {
          failed.push(
            `第 ${i + 1} 行：提醒日期與事件同天（\`${formatEventDate(dateStr)}\`），提醒時間（\`${remindTimeDisplay}\`）不能晚於或等於事件時間（\`${timeStr}\`）`,
          );
          continue;
        }

        const remindAt = calcReminderTime(
          dateStr,
          parsedRemindTime.hour,
          parsedRemindTime.minute,
          remindDateRaw || null,
        );
        if (!remindAt) {
          failed.push(`第 ${i + 1} 行：日期格式錯誤（\`${dateStr}\`）`);
          continue;
        }

        if (remindAt <= now) {
          failed.push(`第 ${i + 1} 行：提醒時間已過，無法設定（\`${formatEventDate(dateStr)}\`）`);
          continue;
        }

        const isDuplicate = isDuplicateReminder(reminders, {
          userId,
          eventDate: dateStr,
          eventTime: timeStr,
          message,
          remindTime: remindTimeDisplay,
          remindDate: remindDateRaw,
        });
        if (isDuplicate) {
          failed.push(
            `第 ${i + 1} 行：\`${formatEventDate(dateStr)}${timeStr ? ` ${timeStr}` : ''}\` 已有相同提醒「${message}」`,
          );
          continue;
        }

        const id = `${userId}-${Date.now()}-${i}-${Math.random().toString(36).slice(2)}`;
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
        toSchedule.push(reminder);
        const eventDisplay = timeStr
          ? `${formatEventDate(dateStr)} ${timeStr}`
          : formatEventDate(dateStr);
        success.push(`\`${eventDisplay}\`　${message}`);
      }

      await saveReminders(reminders);
      return { toSchedule };
    });

    toSchedule.forEach(scheduleReminder);

    const color = failed.length === 0 ? 0x57f287 : success.length === 0 ? 0xed4245 : 0xfee75c;

    const embed = new EmbedBuilder().setTitle('📥 批次匯入結果').setColor(color);

    if (success.length > 0) {
      embed.addFields({ name: `✅ 成功 ${success.length} 筆`, value: truncateList(success) });
    }
    if (failed.length > 0) {
      embed.addFields({ name: `❌ 失敗 ${failed.length} 筆`, value: truncateList(failed) });
    }

    await interaction.editReply({ embeds: [embed] });
    return;
  }

  // ── /help ─────────────────────────────────────────────────
  if (cmd === 'help') {
    const embed = new EmbedBuilder().setTitle('📖 可用指令').setColor(0x5865f2).addFields(
      {
        name: '/remind',
        value:
          '設定提醒，將在指定日期的指定時間發送\n`date` 事件日期（YYYYMMDD）、`message` 提醒內容、`time` 事件時間（HH:MM，選填）、`remind_time`提醒時間（HH:MM，預設為你的個人設定，見 `/remind-default`）、`remind_date` 提醒日期（YYYYMMDD，預設前一天）\n​',
      },
      {
        name: '/remind-default',
        value:
          '查看或設定你的個人預設提醒時間（`/remind` 未指定 `remind_time` 時套用）\n`time` 新的預設時間（HH:MM，選填）、`reset` 重設為系統預設 22:00（選填）\n不帶任何參數時顯示目前設定\n​',
      },
      {
        name: '/reminders',
        value:
          '查看你所有待發送的提醒\n（一次最多顯示 25 筆，可使用 `/reminders-range` 縮小範圍）\n​',
      },
      {
        name: '/reminders-range',
        value:
          '查看指定事件日期區間內的提醒\n`from` 起始日期（YYYYMMDD，必填）、`to` 結束日期（YYYYMMDD，不填則只查 from 當天）\n​',
      },
      {
        name: '/remind-edit',
        value:
          '透過 ID 編輯已設定的提醒，未填寫的欄位將保留原有值\n`id` 提醒 ID（必填）、`message` 新內容、`date` 新事件日期（YYYYMMDD）、`time` 新事件時間（HH:MM）、`remind_date` 新提醒日期（YYYYMMDD）、`remind_time`、新提醒時間（HH:MM）\n​',
      },
      {
        name: '/remind-delete',
        value: '刪除待發送的提醒\n`id` 提醒 ID，多個用空白隔開\n​',
      },
      {
        name: '/remind-import',
        value:
          '從 CSV 檔案批次匯入提醒\n`file` CSV 附件（欄位：date, message, time, remind_time, remind_date）\n​',
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
