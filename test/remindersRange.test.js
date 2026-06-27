const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const remindersRange = require('../commands/remindersRange');
const { errorMessages } = require('../lib/errorHandle');
const { formatEventDate } = require('../lib/utils');

// 假的 interaction：deferReply/editReply 直接記錄收到的參數，options 用 Map 模擬 from/to
function fakeInteraction({ from, to } = {}) {
  const options = new Map();
  if (from !== undefined) options.set('from', from);
  if (to !== undefined) options.set('to', to);
  return {
    user: { id: 'user-1' },
    lastEditReply: null,
    deferReply() {
      return Promise.resolve();
    },
    options: {
      getString(name) {
        return options.has(name) ? options.get(name) : null;
      },
    },
    editReply(payload) {
      this.lastEditReply = payload;
      return Promise.resolve();
    },
  };
}

// 假的 ctx：loadReminders 若被呼叫就記一筆，方便確認「整段已過去」時有沒有提早 return
function fakeCtx() {
  return {
    loadReminderCalls: 0,
    async loadReminders() {
      this.loadReminderCalls += 1;
      return [];
    },
  };
}

describe('/reminders-range', () => {
  test('查詢區間整段已過去 → 回覆過期錯誤，不查詢提醒', async () => {
    const interaction = fakeInteraction({ from: '20200101', to: '20200101' });
    const ctx = fakeCtx();
    await remindersRange.execute(interaction, ctx);
    assert.deepEqual(interaction.lastEditReply, {
      content: errorMessages.dateRangeInPast(formatEventDate('20200101')),
    });
    assert.equal(ctx.loadReminderCalls, 0);
  });

  test('只填 from（早於今天）→ to 預設為 from，同樣視為過期', async () => {
    const interaction = fakeInteraction({ from: '20200101' });
    const ctx = fakeCtx();
    await remindersRange.execute(interaction, ctx);
    assert.deepEqual(interaction.lastEditReply, {
      content: errorMessages.dateRangeInPast(formatEventDate('20200101')),
    });
    assert.equal(ctx.loadReminderCalls, 0);
  });
});
