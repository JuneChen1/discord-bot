const { SlashCommandBuilder } = require('discord.js');
const { recurrenceTypes } = require('./utils');

// /remind-recurring 的 type 選項顯示名稱；合法類型清單本身以 lib/utils.js 的 recurrenceTypes 為單一資料來源
const recurrenceTypeLabels = { daily: '每天 (daily)', weekly: '每週 (weekly)', monthly: '每月 (monthly)' };

// 指令的唯一資料來源：name、description、options、help 都只在這裡寫一次，
// commandDefs（註冊給 Discord）與 helpFields（/help 顯示內容）都由此推導
const commandSpecs = [
  {
    name: 'remind',
    description: '設定提醒，將在指定的日期與時間發送（預設時間可使用 /remind-default 查詢與設定）',
    options: [
      {
        type: 'string',
        name: 'date',
        description: '事件日期，格式 YYYYMMDD，例如 20260510',
        required: true,
      },
      { type: 'string', name: 'message', description: '提醒內容', required: true },
      {
        type: 'string',
        name: 'time',
        description: '事件時間，格式 HH:MM，例如 14:30',
        required: false,
      },
      {
        type: 'string',
        name: 'remind_date',
        description: '提醒日期，格式 YYYYMMDD，預設為事件前一天',
        required: false,
      },
      {
        type: 'string',
        name: 'remind_time',
        description: '提醒時間，格式 HH:MM，預設為你的個人設定（見 /remind-default）',
        required: false,
      },
    ],
    help: '設定提醒，將在指定日期與時間發送\n`date` 事件日期（YYYYMMDD）、`message` 提醒內容、`time` 事件時間（HH:MM，選填）、`remind_time`提醒時間（HH:MM，預設為你的個人設定，見 `/remind-default`）、`remind_date` 提醒日期（YYYYMMDD，預設前一天）\n​',
  },
  {
    name: 'remind-default',
    description: '查看或設定你的個人預設提醒時間（/remind 未指定 remind_time 時套用）',
    options: [
      {
        type: 'string',
        name: 'time',
        description: '新的預設提醒時間，格式 HH:MM，例如 21:00',
        required: false,
      },
      {
        type: 'boolean',
        name: 'reset',
        description: '重設為系統預設（22:00）',
        required: false,
      },
    ],
    help: '查看或設定你的個人預設提醒時間（`/remind` 未指定 `remind_time` 時套用）、\n`time` 新的預設時間（HH:MM，選填）、`reset` 重設為系統預設 22:00（選填）\n不帶任何參數時顯示目前設定\n​',
  },
  {
    name: 'reminders',
    description: '查看你所有待發送的提醒',
    options: [],
    help: '查看你所有待發送的提醒\n（一次最多顯示 25 筆，可使用 `/reminders-range` 縮小範圍）\n​',
  },
  {
    name: 'reminders-range',
    description: '查看指定事件日期區間內的提醒',
    options: [
      {
        type: 'string',
        name: 'from',
        description: '起始日期，格式 YYYYMMDD，例如 20260601',
        required: true,
      },
      {
        type: 'string',
        name: 'to',
        description: '結束日期，格式 YYYYMMDD，例如 20260630（不填則只查 from 當天）',
        required: false,
      },
    ],
    help: '查看指定事件日期區間內的提醒\n`from` 起始日期（YYYYMMDD，必填）、`to` 結束日期（YYYYMMDD，不填則只查起始日期當天）\n​',
  },
  {
    name: 'remind-edit',
    description: '透過 ID 編輯已設定的提醒（至少修改一個欄位）',
    options: [
      {
        type: 'string',
        name: 'id',
        description: '提醒 ID（可從 /reminders 查詢）',
        required: true,
      },
      { type: 'string', name: 'message', description: '新的提醒內容', required: false },
      { type: 'string', name: 'date', description: '新的事件日期，格式 YYYYMMDD', required: false },
      { type: 'string', name: 'time', description: '新的事件時間，格式 HH:MM', required: false },
      {
        type: 'string',
        name: 'remind_date',
        description: '新的提醒日期，格式 YYYYMMDD',
        required: false,
      },
      {
        type: 'string',
        name: 'remind_time',
        description: '新的提醒時間，格式 HH:MM',
        required: false,
      },
    ],
    help: '透過 ID 編輯已設定的提醒，未填寫的欄位將保留原有值\n`id` 提醒 ID（必填）、`message` 新內容、`date` 新事件日期（YYYYMMDD）、`time` 新事件時間（HH:MM）、`remind_date` 新提醒日期（YYYYMMDD）、`remind_time`、新提醒時間（HH:MM）\n​',
  },
  {
    name: 'remind-delete',
    description: '刪除待發送的提醒，支援多個 ID（空白隔開）',
    options: [
      {
        type: 'string',
        name: 'id',
        description: '提醒 ID，多個用空白隔開（ID 可從建立時的訊息底部或 /reminders 查詢）',
        required: true,
      },
    ],
    help: '刪除待發送的提醒\n`id` 提醒 ID，多個用空白隔開\n​',
  },
  {
    name: 'remind-recurring',
    description: '設定週期提醒，依 daily/weekly/monthly 重複發送，需擇一指定 end_date 或 count 作為結束條件',
    options: [
      {
        type: 'string',
        name: 'type',
        description: '週期類型',
        required: true,
        choices: recurrenceTypes.map((type) => ({ name: recurrenceTypeLabels[type], value: type })),
      },
      {
        type: 'string',
        name: 'date',
        description: '第一次事件日期，格式 YYYYMMDD，例如 20260510',
        required: true,
      },
      { type: 'string', name: 'message', description: '提醒內容', required: true },
      {
        type: 'string',
        name: 'time',
        description: '事件時間，格式 HH:MM，例如 14:30',
        required: false,
      },
      {
        type: 'integer',
        name: 'remind_offset_days',
        description: '提醒提前幾天發送，預設 1（ 0 代表當天提醒，每次重複皆套用相同天數）',
        required: false,
        minValue: 0,
      },
      {
        type: 'string',
        name: 'remind_time',
        description: '提醒時間，格式 HH:MM，預設為你的個人設定',
        required: false,
      },
      {
        type: 'string',
        name: 'end_date',
        description: '結束日期，格式 YYYYMMDD（與 count 擇一提供）',
        required: false,
      },
      {
        type: 'integer',
        name: 'count',
        description: '總場次數，至少 1（與 end_date 擇一提供）',
        required: false,
        minValue: 1,
      },
    ],
    help: '設定週期提醒（每天/每週/每月重複），需擇一指定 `end_date` 或 `count` 作為結束條件\n`type` 週期類型（daily/weekly/monthly）、`date` 第一次事件日期（YYYYMMDD）、`message` 提醒內容、`time` 事件時間（HH:MM，選填）、`remind_time` 提醒時間（HH:MM，預設個人設定）、`remind_offset_days` 提醒提前幾天發送（預設 1，每次重複皆套用相同天數）、`end_date` 結束日期（YYYYMMDD）、`count` 總場次數（end_date 與 count 擇一）\n​',
  },
  {
    name: 'remind-import',
    description: '從 CSV 檔案批次匯入提醒，支援一般與週期提醒',
    options: [
      {
        type: 'attachment',
        name: 'file',
        description:
          'CSV 檔案（欄位：date, message, time, remind_time, remind_date, type, remind_offset_days, end_date, count）',
        required: true,
      },
    ],
    help: '從 CSV 檔案批次匯入提醒，支援一般與週期提醒\n`file` CSV 附件（欄位：date, message, time, remind_time, remind_date, type, remind_offset_days, end_date, count）\n`type` 有填（daily/weekly/monthly）即為週期提醒，此時改用 `remind_offset_days`（提前幾天，預設 1）取代 `remind_date`，並需擇一提供 `end_date` 或 `count`\n​',
  },
  {
    name: 'help',
    description: '查看所有可用指令',
    options: [],
    help: '查看所有可用指令',
  },
];

function addOptionToBuilder(builder, option, commandName) {
  const applyCommonFields = (opt) => {
    opt.setName(option.name).setDescription(option.description).setRequired(option.required);
    if (option.choices) opt.addChoices(...option.choices);
    return opt;
  };

  switch (option.type) {
    case 'string':
      return builder.addStringOption(applyCommonFields);
    case 'integer':
      return builder.addIntegerOption((opt) => {
        applyCommonFields(opt);
        if (option.minValue !== undefined) opt.setMinValue(option.minValue);
        return opt;
      });
    case 'boolean':
      return builder.addBooleanOption(applyCommonFields);
    case 'attachment':
      return builder.addAttachmentOption(applyCommonFields);
    default:
      throw new Error(
        `未知的選項型別 "${option.type}"（指令：${commandName}，選項：${option.name}）`,
      );
  }
}

function buildCommandDef(spec) {
  let builder = new SlashCommandBuilder().setName(spec.name).setDescription(spec.description);

  for (const option of spec.options) {
    builder = addOptionToBuilder(builder, option, spec.name);
  }

  return builder.toJSON();
}

const commandDefs = commandSpecs.map(buildCommandDef);

const helpFields = commandSpecs.map((spec) => ({
  name: `/${spec.name}`,
  value: spec.help,
}));

module.exports = { commandDefs, helpFields };
