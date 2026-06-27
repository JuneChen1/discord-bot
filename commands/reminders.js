const { EmbedBuilder, MessageFlags } = require('discord.js');
const { editReply } = require('../lib/replyHelpers');
const { maxRemindersList, reminderToField } = require('../lib/reminderHelpers');

module.exports = {
  name: 'reminders',
  async execute(interaction, ctx) {
    const userId = interaction.user.id;
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const reminders = (await ctx.loadReminders()).filter((r) => r.userId === userId);

    if (reminders.length === 0) {
      await editReply(interaction, '📭 你目前沒有任何待發送的提醒。');
      return;
    }

    const sorted = reminders.sort((a, b) => a.eventDate.localeCompare(b.eventDate));
    const shown = sorted.slice(0, maxRemindersList);
    const overflow = sorted.length - shown.length;
    const embed = new EmbedBuilder().setTitle('📋 你的提醒清單').setColor(0x5865f2);

    for (const r of shown) {
      embed.addFields(reminderToField(r));
    }
    if (overflow > 0) {
      embed.setFooter({ text: `尚有 ${overflow} 筆未顯示` });
    }

    await editReply(interaction, { embeds: [embed] });
  },
};
