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

const { commandDefs } = require('./lib/commands');
const { errorMessages } = require('./lib/errorHandle');
const { commands } = require('./commands');
const { buildNextOccurrence } = require('./lib/reminderHelpers');

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
  activeTimers.delete(reminder.id);

  // 發送本次提醒訊息獨立於下方「計算/儲存下一場次」之外，
  // 避免週期提醒的續期邏輯出錯時（例如 reminders.json 被手動編輯出不合法的 recurrence.type）連本次通知都發不出去
  try {
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

  let nextReminder = null;
  try {
    await withReminderLock(async () => {
      const reminders = await loadReminders();
      const remaining = reminders.filter((r) => r.id !== reminder.id);
      if (reminder.recurrence) {
        try {
          nextReminder = buildNextOccurrence(reminder);
        } catch (err) {
          console.error(`[fireReminder] 週期提醒 ${reminder.id} 計算下一場次失敗，系列將終止：`, err);
          nextReminder = null;
        }
      }
      await saveReminders(nextReminder ? [...remaining, nextReminder] : remaining);
    });
  } catch (err) {
    console.error(`[fireReminder] 提醒 ${reminder.id} 更新儲存失敗：`, err);
  }

  if (nextReminder) scheduleReminder(nextReminder);
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

  // commandDefs（註冊給 Discord）與 commands（實際 handler）分別在 lib/commands.js、commands/index.js 手動維護，
  // 兩者名稱不同步時不會有任何執行期錯誤，因此在啟動時主動檢查
  const missingHandlers = commandDefs
    .map((command) => command.name)
    .filter((name) => !commands.has(name));
  if (missingHandlers.length > 0) {
    console.error(`以下指令已註冊但缺少對應的 handler：${missingHandlers.join(', ')}`);
    process.exit(1);
  }

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

const ctx = {
  loadReminders,
  saveReminders,
  loadUserSettings,
  saveUserSettings,
  withReminderLock,
  withUserSettingsLock,
  scheduleReminder,
  cancelReminder,
  getTargetChannel,
};

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  try {
    const command = commands.get(interaction.commandName);
    if (!command) {
      console.warn(`[${interaction.commandName}] 找不到對應的指令 handler`);
      return;
    }
    await command.execute(interaction, ctx);
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
