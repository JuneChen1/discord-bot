const { EmbedBuilder } = require('discord.js');
const { helpFields } = require('../lib/commands');
const { replyEphemeral } = require('../lib/replyHelpers');

module.exports = {
  name: 'help',
  async execute(interaction) {
    const embed = new EmbedBuilder()
      .setTitle('📖 可用指令')
      .setColor(0x5865f2)
      .addFields(...helpFields);

    await replyEphemeral(interaction, { embeds: [embed] });
  },
};
