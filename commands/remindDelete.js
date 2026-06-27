const { EmbedBuilder } = require('discord.js');
const { errorMessages } = require('../lib/errorHandle');
const { replyEphemeral } = require('../lib/replyHelpers');
const { buildEventDateDisplay, truncateList } = require('../lib/reminderHelpers');

module.exports = {
  name: 'remind-delete',
  async execute(interaction, ctx) {
    const userId = interaction.user.id;
    const ids = interaction.options.getString('id').trim().split(/\s+/);

    const { deleted, failed } = await ctx.withReminderLock(async () => {
      const reminders = await ctx.loadReminders();
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
        ctx.cancelReminder(targetId);
        deleted.push(
          `📅 ${buildEventDateDisplay(target.eventDate, target.eventTime)}　💬 ${target.message}`,
        );
        reminders.splice(idx, 1);
      }

      if (deleted.length > 0) {
        await ctx.saveReminders(reminders);
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
  },
};
