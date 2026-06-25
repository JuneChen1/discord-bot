const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
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
  defaultRemindHour,
  defaultRemindMinute,
  toMinutes,
  formatEventDate,
  formatTaipeiTime,
  parseCSVLine,
  parseRemindTime,
  getUserRemindDefault,
  isValidDateStr,
  calcReminderTime,
  filterRemindersByRange,
  validateReminderInput,
  applyReminderEdits,
} = require('./lib/utils');
const { commandDefs, helpFields } = require('./lib/commands');
const { errorMessages } = require('./lib/errorHandle');
const { replyEphemeral, editReply } = require('./lib/replyHelpers');
const {
  maxEmbedFields,
  generateReminderId,
  buildReminderRecord,
  isDuplicate,
  buildEventDateDisplay,
  buildReminderResultEmbed,
  reminderToField,
  truncateList,
} = require('./lib/reminderHelpers');

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
const maxTimeoutMs = 2147483647;

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
  const wait = Math.min(delay, maxTimeoutMs);
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

// ─────────────────────────────────────────────────────────

client.once('clientReady', async () => {
  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  try {
    await rest.put(Routes.applicationCommands(client.user.id), { body: commandDefs });
  } catch (err) {
    console.error('指令註冊失敗：', err);
    process.exit(1);
  }
  console.log(`Bot 已上線：${client.user.tag}`);
  console.log(`已註冊指令：${commandDefs.map((command) => command.name).join(', ')}`);

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
      await replyEphemeral(interaction, validated.error);
      return;
    }
    const { remindTimeDisplay, remindAt } = validated;

    const outcome = await withReminderLock(async () => {
      const reminders = await loadReminders();

      const duplicate = isDuplicate(reminders, {
        userId,
        eventDate: dateStr,
        eventTime: timeStr,
        message,
        remindTime: remindTimeDisplay,
        remindDate: remindDateStr,
      });
      if (duplicate) return { duplicate: true };

      const reminder = buildReminderRecord({
        id: generateReminderId(userId),
        userId,
        userName: interaction.user.username,
        channelId: targetChannel.id,
        message,
        eventDate: dateStr,
        eventTime: timeStr,
        remindTime: remindTimeDisplay,
        remindDate: remindDateStr,
        remindAt,
      });

      reminders.push(reminder);
      await saveReminders(reminders);
      return { reminder };
    });

    if (outcome.duplicate) {
      await replyEphemeral(
        interaction,
        errorMessages.duplicateReminder(formatEventDate(dateStr), timeStr, message),
      );
      return;
    }

    const { reminder } = outcome;
    scheduleReminder(reminder);

    const embed = buildReminderResultEmbed({
      title: '✅ 提醒已設定',
      color: 0x57f287,
      channelId: targetChannel.id,
      message,
      eventDate: dateStr,
      eventTime: timeStr,
      remindAt,
      footerId: reminder.id,
    });

    await replyEphemeral(interaction, { embeds: [embed] });
    return;
  }

  // ── /remind-default ──────────────────────────────────────
  if (cmd === 'remind-default') {
    const timeInput = (interaction.options.getString('time') ?? '').trim() || null;
    const reset = interaction.options.getBoolean('reset') ?? false;

    if (timeInput && reset) {
      await replyEphemeral(interaction, errorMessages.timeAndResetConflict);
      return;
    }

    if (reset) {
      await withUserSettingsLock(async () => {
        const settings = await loadUserSettings();
        delete settings[userId];
        await saveUserSettings(settings);
      });
      await replyEphemeral(
        interaction,
        `✅ 已重設為系統預設提醒時間：\`${String(defaultRemindHour).padStart(2, '0')}:${String(defaultRemindMinute).padStart(2, '0')}\`（台灣時間）。`,
      );
      return;
    }

    if (timeInput) {
      const parsed = parseRemindTime(timeInput);
      if (!parsed) {
        await replyEphemeral(interaction, errorMessages.invalidTimeFormat);
        return;
      }
      const display = `${String(parsed.hour).padStart(2, '0')}:${String(parsed.minute).padStart(2, '0')}`;
      await withUserSettingsLock(async () => {
        const settings = await loadUserSettings();
        settings[userId] = { remindHour: parsed.hour, remindMinute: parsed.minute };
        await saveUserSettings(settings);
      });
      await replyEphemeral(
        interaction,
        `✅ 你的個人預設提醒時間已設定為 \`${display}\`（台灣時間），\`/remind\` 未指定 \`remind_time\` 時將套用此設定。`,
      );
      return;
    }

    const settings = await loadUserSettings();
    const current = getUserRemindDefault(settings, userId);
    const display = `${String(current.hour).padStart(2, '0')}:${String(current.minute).padStart(2, '0')}`;
    const isCustom = Object.hasOwn(settings, userId);
    await replyEphemeral(
      interaction,
      `⏰ 你目前的個人預設提醒時間：\`${display}\`（台灣時間）${isCustom ? '' : '　（尚未自訂，使用系統預設）'}`,
    );
    return;
  }

  // ── /reminders ───────────────────────────────────────────
  if (cmd === 'reminders') {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const reminders = (await loadReminders()).filter((r) => r.userId === userId);

    if (reminders.length === 0) {
      await editReply(interaction, '📭 你目前沒有任何待發送的提醒。');
      return;
    }

    const sorted = reminders.sort((a, b) => a.eventDate.localeCompare(b.eventDate));
    const shown = sorted.slice(0, maxEmbedFields);
    const overflow = sorted.length - shown.length;
    const embed = new EmbedBuilder().setTitle('📋 你的提醒清單').setColor(0x5865f2);

    for (const r of shown) {
      embed.addFields(reminderToField(r));
    }
    if (overflow > 0) {
      embed.setFooter({ text: `尚有 ${overflow} 筆未顯示` });
    }

    await editReply(interaction, { embeds: [embed] });
    return;
  }

  // ── /reminders-range ─────────────────────────────────────
  if (cmd === 'reminders-range') {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const fromStr = interaction.options.getString('from').trim();
    const toStr = (interaction.options.getString('to') ?? '').trim() || fromStr;

    if (!isValidDateStr(fromStr) || !isValidDateStr(toStr)) {
      await editReply(interaction, errorMessages.invalidDateRangeFormat);
      return;
    }
    if (fromStr > toStr) {
      await editReply(interaction, errorMessages.invalidDateRangeOrder);
      return;
    }

    const rangeLabel =
      fromStr === toStr
        ? formatEventDate(fromStr)
        : `${formatEventDate(fromStr)} ～ ${formatEventDate(toStr)}`;
    const inRange = filterRemindersByRange(await loadReminders(), userId, fromStr, toStr);

    if (inRange.length === 0) {
      await editReply(interaction, `📭 ${rangeLabel} 沒有任何提醒。`);
      return;
    }

    const shown = inRange.slice(0, maxEmbedFields);
    const overflow = inRange.length - shown.length;
    const embed = new EmbedBuilder().setTitle(`📋 提醒清單（${rangeLabel}）`).setColor(0x5865f2);

    for (const r of shown) {
      embed.addFields(reminderToField(r));
    }
    if (overflow > 0) {
      embed.setFooter({ text: `尚有 ${overflow} 筆未顯示` });
    }

    await editReply(interaction, { embeds: [embed] });
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
      await replyEphemeral(interaction, errorMessages.noEditFieldsProvided);
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
        isDuplicate(otherReminders, {
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

      const updated = buildReminderRecord({
        id: existing.id,
        userId: existing.userId,
        userName: existing.userName,
        channelId: existing.channelId,
        message,
        eventDate: dateStr,
        eventTime: timeStr,
        remindTime: remindTimeDisplay,
        remindDate: remindDateStr,
        remindAt,
      });

      reminders[idx] = updated;
      await saveReminders(reminders);
      return { updated, existing };
    });

    if (outcome.error === 'not-found') {
      await replyEphemeral(interaction, errorMessages.reminderNotFound(targetId));
      return;
    }
    if (outcome.error === 'forbidden') {
      await replyEphemeral(interaction, errorMessages.notOwnerEdit);
      return;
    }
    if (outcome.error === 'validation') {
      await replyEphemeral(interaction, outcome.message);
      return;
    }
    if (outcome.error === 'duplicate') {
      const { dateStr, timeStr, message } = outcome;
      await replyEphemeral(
        interaction,
        errorMessages.duplicateReminder(formatEventDate(dateStr), timeStr, message),
      );
      return;
    }

    const { updated, existing } = outcome;
    scheduleReminder(updated);

    const embed = buildReminderResultEmbed({
      title: '✏️ 提醒已更新',
      color: 0x5865f2,
      channelId: existing.channelId,
      message: updated.message,
      eventDate: updated.eventDate,
      eventTime: updated.eventTime,
      remindAt: updated.remindAt,
      footerId: targetId,
    });

    await replyEphemeral(interaction, { embeds: [embed] });
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
          failed.push(errorMessages.reminderNotFoundForDelete(targetId));
          continue;
        }
        const target = reminders[idx];
        if (target.userId !== userId) {
          failed.push(errorMessages.notOwnerDelete(targetId));
          continue;
        }
        cancelReminder(targetId);
        deleted.push(
          `📅 ${buildEventDateDisplay(target.eventDate, target.eventTime)}　💬 ${target.message}`,
        );
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

    await replyEphemeral(interaction, { embeds: [embed] });
    return;
  }

  // ── /remind-import ───────────────────────────────────────
  if (cmd === 'remind-import') {
    const attachment = interaction.options.getAttachment('file');

    if (!attachment.name.endsWith('.csv')) {
      await replyEphemeral(interaction, errorMessages.invalidCsvFile);
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    let text;
    try {
      const res = await fetch(attachment.url);
      text = await res.text();
    } catch {
      await interaction.editReply(errorMessages.csvReadFailed);
      return;
    }

    // 去掉 UTF-8 BOM（Excel 存出的 CSV 會帶這個）
    text = text.replace(/^\uFEFF/, '');
    const lines = text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l);
    if (lines.length === 0) {
      await interaction.editReply(errorMessages.csvEmpty);
      return;
    }

    // 若第一行是 header 則跳過
    const dataLines = lines[0].toLowerCase().startsWith('date') ? lines.slice(1) : lines;
    if (dataLines.length === 0) {
      await interaction.editReply(errorMessages.csvHeaderOnly);
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
        const lineNumber = i + 1;
        const fields = parseCSVLine(dataLines[i]);
        if (fields === null) {
          failed.push(errorMessages.csvLineQuoteError(lineNumber));
          continue;
        }
        const dateStr = (fields[0] ?? '').trim();
        const message = (fields[1] ?? '').trim();
        const timeStr = (fields[2] ?? '').trim();
        const remindTimeRaw = (fields[3] ?? '').trim();
        const remindDateRaw = (fields[4] ?? '').trim();

        if (!dateStr || !message) {
          failed.push(errorMessages.csvLineMissingFields(lineNumber));
          continue;
        }

        if (!isValidDateStr(dateStr)) {
          failed.push(errorMessages.csvLineInvalidDate(lineNumber, dateStr));
          continue;
        }

        const defaults = remindTimeRaw ? null : await getUserDefault();
        const parsedRemindTime = parseRemindTime(
          remindTimeRaw || null,
          defaults?.hour,
          defaults?.minute,
        );
        if (!parsedRemindTime) {
          failed.push(errorMessages.csvLineInvalidRemindTime(lineNumber, remindTimeRaw));
          continue;
        }

        if (remindDateRaw && !isValidDateStr(remindDateRaw)) {
          failed.push(errorMessages.csvLineInvalidRemindDate(lineNumber, remindDateRaw));
          continue;
        }

        if (remindDateRaw && remindDateRaw > dateStr) {
          failed.push(
            errorMessages.csvLineRemindDateAfterEventDate(
              lineNumber,
              formatEventDate(remindDateRaw),
              formatEventDate(dateStr),
            ),
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
            errorMessages.csvLineRemindTimeAfterEventTime(
              lineNumber,
              formatEventDate(dateStr),
              remindTimeDisplay,
              timeStr,
            ),
          );
          continue;
        }

        // dateStr 與 remindDateRaw（若有提供）已在上方驗證過，calcReminderTime 不會再回傳 null
        const remindAt = calcReminderTime(
          dateStr,
          parsedRemindTime.hour,
          parsedRemindTime.minute,
          remindDateRaw || null,
        );

        if (remindAt <= now) {
          failed.push(errorMessages.csvLineRemindTimeExpired(lineNumber, formatEventDate(dateStr)));
          continue;
        }

        const duplicate = isDuplicate(reminders, {
          userId,
          eventDate: dateStr,
          eventTime: timeStr,
          message,
          remindTime: remindTimeDisplay,
          remindDate: remindDateRaw,
        });
        if (duplicate) {
          failed.push(
            errorMessages.csvLineDuplicate(lineNumber, formatEventDate(dateStr), timeStr, message),
          );
          continue;
        }

        const reminder = buildReminderRecord({
          id: generateReminderId(userId, i),
          userId,
          userName: interaction.user.username,
          channelId: targetChannel.id,
          message,
          eventDate: dateStr,
          eventTime: timeStr,
          remindTime: remindTimeDisplay,
          remindDate: remindDateRaw,
          remindAt,
        });

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
    const embed = new EmbedBuilder()
      .setTitle('📖 可用指令')
      .setColor(0x5865f2)
      .addFields(...helpFields);

    await replyEphemeral(interaction, { embeds: [embed] });
    return;
  }
}

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  try {
    await handleInteraction(interaction);
  } catch (err) {
    console.error(`[${interaction.commandName}] 未預期錯誤：`, err);
    const payload = { content: errorMessages.unexpectedError, flags: MessageFlags.Ephemeral };
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply(payload).catch(() => {});
    } else {
      await interaction.reply(payload).catch(() => {});
    }
  }
});

client.login(process.env.DISCORD_TOKEN);
