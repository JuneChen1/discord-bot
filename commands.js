const { SlashCommandBuilder } = require('discord.js');

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

// /help 指令顯示的指令說明，集中管理方便新增/修改指令時同步更新
// 注意：修改上方 commandDefs（名稱、選項）時，請同步檢查這裡的說明文字是否需要更新
const helpFields = [
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
    value: '查看你所有待發送的提醒\n（一次最多顯示 25 筆，可使用 `/reminders-range` 縮小範圍）\n​',
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
];

module.exports = { commandDefs, helpFields };
