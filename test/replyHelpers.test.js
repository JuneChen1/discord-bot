const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { MessageFlags } = require('discord.js');
const { replyEphemeral } = require('../lib/replyHelpers');

// 假的 interaction：reply 直接回傳收到的參數，方便檢查組裝結果
function fakeInteraction() {
  return {
    lastReply: null,
    reply(options) {
      this.lastReply = options;
      return Promise.resolve(options);
    },
  };
}

describe('replyEphemeral', () => {
  test('字串 payload → 組成 content + Ephemeral flag', async () => {
    const interaction = fakeInteraction();
    await replyEphemeral(interaction, '❌ 錯誤訊息');
    assert.deepEqual(interaction.lastReply, {
      content: '❌ 錯誤訊息',
      flags: MessageFlags.Ephemeral,
    });
  });

  test('物件 payload → 保留原欄位並補上 Ephemeral flag', async () => {
    const interaction = fakeInteraction();
    const embed = { title: '測試' };
    await replyEphemeral(interaction, { embeds: [embed] });
    assert.deepEqual(interaction.lastReply, {
      embeds: [embed],
      flags: MessageFlags.Ephemeral,
    });
  });

  test('payload 為 null → 拋出錯誤', () => {
    const interaction = fakeInteraction();
    assert.throws(() => replyEphemeral(interaction, null), /缺少 payload/);
  });

  test('payload 為 undefined → 拋出錯誤', () => {
    const interaction = fakeInteraction();
    assert.throws(() => replyEphemeral(interaction, undefined), /缺少 payload/);
  });

  test('呼叫端傳入的 flags 會被覆蓋為 Ephemeral', async () => {
    const interaction = fakeInteraction();
    await replyEphemeral(interaction, { content: '測試', flags: 0 });
    assert.equal(interaction.lastReply.flags, MessageFlags.Ephemeral);
  });
});
