const { EmbedBuilder, MessageFlags } = require('discord.js');
const {
  formatEventDate,
  isValidDateStr,
  filterRemindersByRange,
  getTaipeiDateStr,
} = require('../lib/utils');
const { errorMessages } = require('../lib/errorHandle');
const { editReply } = require('../lib/replyHelpers');
const { maxRemindersList, reminderToField } = require('../lib/reminderHelpers');

module.exports = {
  name: 'reminders-range',
  async execute(interaction, ctx) {
    const userId = interaction.user.id;
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const fromStr = interaction.options.getString('from').trim();
    const toStr = (interaction.options.getString('to') ?? '').trim() || fromStr;

    if (!isValidDateStr(fromStr) || !isValidDateStr(toStr)) {
      await editReply(interaction, errorMessages.invalidDateRangeFormat);
      return;
    }
    if (fromStr > toStr) {
      await editReply(interaction, errorMessages.invalidDateRangeOrder);
      return;
    }
    if (toStr < getTaipeiDateStr()) {
      await editReply(interaction, errorMessages.dateRangeInPast(formatEventDate(toStr)));
      return;
    }

    const rangeLabel =
      fromStr === toStr
        ? formatEventDate(fromStr)
        : `${formatEventDate(fromStr)} ～ ${formatEventDate(toStr)}`;
    const inRange = filterRemindersByRange(await ctx.loadReminders(), userId, fromStr, toStr);

    if (inRange.length === 0) {
      await editReply(interaction, `📭 ${rangeLabel} 沒有任何提醒。`);
      return;
    }

    const shown = inRange.slice(0, maxRemindersList);
    const overflow = inRange.length - shown.length;
    const embed = new EmbedBuilder().setTitle(`📋 提醒清單（${rangeLabel}）`).setColor(0x5865f2);

    for (const r of shown) {
      embed.addFields(reminderToField(r));
    }
    if (overflow > 0) {
      embed.setFooter({ text: `尚有 ${overflow} 筆未顯示` });
    }

    await editReply(interaction, { embeds: [embed] });
  },
};
