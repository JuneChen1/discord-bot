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

// ── 提醒功能 ──────────────────────────────────────────────

const REMINDERS_FILE = path.join(__dirname, 'reminders.json');

function loadReminders() {
  if (fs.existsSync(REMINDERS_FILE)) {
    return JSON.parse(fs.readFileSync(REMINDERS_FILE, 'utf8'));
  }
  return [];
}

function saveReminders(reminders) {
  fs.writeFileSync(REMINDERS_FILE, JSON.stringify(reminders, null, 2), 'utf8');
}

// 給定事件日期，回傳前一天 22:00 台灣時間的 UTC timestamp (ms)
function calcReminderTime(eventDateStr) {
  if (!/^\d{8}$/.test(eventDateStr)) return null;
  const y = Number(eventDateStr.slice(0, 4));
  const m = Number(eventDateStr.slice(4, 6));
  const d = Number(eventDateStr.slice(6, 8));
  const eventDate = new Date(Date.UTC(y, m - 1, d));
  if (isNaN(eventDate)) return null;
  // 前一天 22:00 UTC+8 = 前一天 14:00 UTC
  const prevDay = new Date(eventDate);
  prevDay.setUTCDate(prevDay.getUTCDate() - 1);
  prevDay.setUTCHours(14, 0, 0, 0);
  return prevDay.getTime();
}

// setTimeout 最大值約 24.8 天，超過需分段遞迴
const MAX_TIMEOUT_MS = 2147483647;

// reminder.id -> timer handle，用於取消
const activeTimers = new Map();

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
    .setDescription('設定提醒，將在事件前一天晚上 22:00（台灣時間）發送')
    .addStringOption((opt) =>
      opt.setName('date').setDescription('事件日期，格式 YYYYMMDD，例如 20260510').setRequired(true)
    )
    .addStringOption((opt) =>
      opt.setName('message').setDescription('提醒內容').setRequired(true)
    )
    .addStringOption((opt) =>
      opt.setName('time').setDescription('事件時間，格式 HH:MM，例如 14:30（選填）').setRequired(false)
    )
    .toJSON(),

  new SlashCommandBuilder()
    .setName('reminders')
    .setDescription('查看你所有待發送的提醒')
    .toJSON(),

  new SlashCommandBuilder()
    .setName('remind-delete')
    .setDescription('刪除一個待發送的提醒')
    .addStringOption((opt) =>
      opt.setName('id').setDescription('提醒 ID（設定時訊息底部可查到）').setRequired(true)
    )
    .toJSON(),

  new SlashCommandBuilder()
    .setName('help')
    .setDescription('查看所有可用指令')
    .toJSON(),
];

client.once('ready', async () => {
  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  await rest.put(Routes.applicationCommands(client.user.id), { body: commandDefs });
  console.log(`Bot 已上線：${client.user.tag}`);
  console.log('已註冊指令：remind, reminders, remind-delete');

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
    const targetChannel =
      (process.env.REMINDER_CHANNEL_ID
        ? client.channels.cache.get(process.env.REMINDER_CHANNEL_ID)
        : null) ??
      interaction.channel;

    const remindAt = calcReminderTime(dateStr);

    if (!remindAt) {
      await interaction.reply({
        content: '❌ 日期格式錯誤！請使用 `YYYYMMDD`，例如 `20260510`。',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (remindAt <= Date.now()) {
      await interaction.reply({
        content: '❌ 事件日期太近，前一天 22:00 已過！請設定至少後天以後的日期。',
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
      remindAt,
    };

    const reminders = loadReminders();
    reminders.push(reminder);
    saveReminders(reminders);
    scheduleReminder(reminder);

    const displayRemindTime = new Date(remindAt).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' });

    const eventDateDisplay = timeStr ? `${dateStr}　🕐 ${timeStr}` : dateStr;
    const embed = new EmbedBuilder()
      .setTitle('✅ 提醒已設定')
      .addFields(
        { name: '📅 事件日期', value: eventDateDisplay, inline: true },
        { name: '📍 頻道', value: `<#${targetChannel.id}>`, inline: true },
        { name: '💬 內容', value: message },
        { name: '⏰ 提醒時間', value: `${displayRemindTime}（前一天晚上 22:00）` }
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
      const eventDate = r.eventDate ?? '未知';
      const remindTime = new Date(r.remindAt).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' });
      const eventTimeDisplay = r.eventTime ? `　🕐 ${r.eventTime}` : '';
      embed.addFields({
        name: `📅 事件：${eventDate}${eventTimeDisplay}　⏰ 提醒：${remindTime}`,
        value: `💬 ${r.message}\n📍 <#${r.channelId}>\n🆔 \`${r.id}\``,
      });
    }

    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    return;
  }

  // ── /remind-delete ────────────────────────────────────────
  if (cmd === 'remind-delete') {
    const targetId = interaction.options.getString('id');
    const reminders = loadReminders();
    const target = reminders.find(r => r.id === targetId);

    if (!target) {
      await interaction.reply({ content: '❌ 找不到該 ID 的提醒，請確認 ID 是否正確。', flags: MessageFlags.Ephemeral });
      return;
    }

    if (target.userId !== userId) {
      await interaction.reply({ content: '❌ 你只能刪除自己設定的提醒。', flags: MessageFlags.Ephemeral });
      return;
    }

    cancelReminder(targetId);
    saveReminders(reminders.filter(r => r.id !== targetId));

    const deletedDateDisplay = target.eventTime
      ? `${target.eventDate ?? '未知'}　🕐 ${target.eventTime}`
      : (target.eventDate ?? '未知');
    const embed = new EmbedBuilder()
      .setTitle('🗑️ 提醒已刪除')
      .addFields(
        { name: '📅 事件日期', value: deletedDateDisplay, inline: true },
        { name: '💬 內容', value: target.message },
      )
      .setColor(0xed4245)
      .setFooter({ text: `ID: ${targetId}` });

    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
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
          value: '設定提醒，將在事件前一天晚上 22:00（台灣時間）發送\n`date` 事件日期（YYYYMMDD）　`message` 提醒內容　`time` 事件時間（HH:MM，選填）\n​',
        },
        {
          name: '/reminders',
          value: '查看你所有待發送的提醒\n​',
        },
        {
          name: '/remind-delete',
          value: '刪除一個待發送的提醒\n`id` 提醒 ID\n​',
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
