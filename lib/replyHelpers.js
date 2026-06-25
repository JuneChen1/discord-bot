const { MessageFlags } = require('discord.js');

// 統一處理「只有指令呼叫者自己看得到」的暫時回覆
// payload 為字串時當作 content：replyEphemeral(interaction, '❌ 錯誤訊息')
// payload 為物件時直接展開：replyEphemeral(interaction, { embeds: [embed] })
function replyEphemeral(interaction, payload) {
  if (payload == null) {
    throw new Error('replyEphemeral: 缺少 payload（content 字串或 { embeds } 物件）');
  }
  const options = typeof payload === 'string' ? { content: payload } : payload;
  return interaction.reply({ ...options, flags: MessageFlags.Ephemeral });
}

// 統一處理 deferReply 後的編輯回覆；payload 為字串時當作 content
function editReply(interaction, payload) {
  if (payload == null) {
    throw new Error('editReply: 缺少 payload（content 字串或 { embeds } 物件）');
  }
  const options = typeof payload === 'string' ? { content: payload } : payload;
  return interaction.editReply(options);
}

module.exports = { replyEphemeral, editReply };
