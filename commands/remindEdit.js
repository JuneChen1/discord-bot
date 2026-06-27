const { formatEventDate, validateReminderInput, applyReminderEdits } = require('../lib/utils');
const { errorMessages } = require('../lib/errorHandle');
const { replyEphemeral } = require('../lib/replyHelpers');
const {
  buildReminderRecord,
  isDuplicate,
  buildReminderResultEmbed,
} = require('../lib/reminderHelpers');

module.exports = {
  name: 'remind-edit',
  async execute(interaction, ctx) {
    const userId = interaction.user.id;
    const targetId = interaction.options.getString('id').trim();
    const newMessage = interaction.options.getString('message');
    const newDateStr = interaction.options.getString('date');
    const newTimeStr = interaction.options.getString('time');
    const newRemindDateStr = interaction.options.getString('remind_date');
    const newRemindTimeStr = interaction.options.getString('remind_time');

    if (
      newMessage === null &&
      newDateStr === null &&
      newTimeStr === null &&
      newRemindDateStr === null &&
      newRemindTimeStr === null
    ) {
      await replyEphemeral(interaction, errorMessages.noEditFieldsProvided);
      return;
    }

    const outcome = await ctx.withReminderLock(async () => {
      const reminders = await ctx.loadReminders();
      const idx = reminders.findIndex((r) => r.id === targetId);

      if (idx === -1) return { error: 'not-found' };

      const existing = reminders[idx];

      if (existing.userId !== userId) return { error: 'forbidden' };

      const patches = {};
      if (newDateStr !== null) patches.date = newDateStr;
      if (newMessage !== null) patches.message = newMessage;
      if (newTimeStr !== null) patches.time = newTimeStr;
      if (newRemindDateStr !== null) patches.remindDate = newRemindDateStr;
      if (newRemindTimeStr !== null) patches.remindTime = newRemindTimeStr;

      const { dateStr, message, timeStr, remindDateStr, remindTimeRaw } = applyReminderEdits(
        existing,
        patches,
      );

      const validated = validateReminderInput({ dateStr, timeStr, remindDateStr, remindTimeRaw });
      if (validated.error) return { error: 'validation', message: validated.error };
      const { remindTimeDisplay, remindAt } = validated;

      const otherReminders = reminders.filter((r) => r.id !== targetId);
      if (
        isDuplicate(otherReminders, {
          userId,
          eventDate: dateStr,
          eventTime: timeStr,
          message,
          remindTime: remindTimeDisplay,
          remindDate: remindDateStr,
        })
      ) {
        return { error: 'duplicate', dateStr, timeStr, message };
      }

      ctx.cancelReminder(targetId);

      const updated = buildReminderRecord({
        id: existing.id,
        userId: existing.userId,
        userName: existing.userName,
        channelId: existing.channelId,
        message,
        eventDate: dateStr,
        eventTime: timeStr,
        remindTime: remindTimeDisplay,
        remindDate: remindDateStr,
        remindAt,
      });

      reminders[idx] = updated;
      await ctx.saveReminders(reminders);
      return { updated, existing };
    });

    if (outcome.error === 'not-found') {
      await replyEphemeral(interaction, errorMessages.reminderNotFound(targetId));
      return;
    }
    if (outcome.error === 'forbidden') {
      await replyEphemeral(interaction, errorMessages.notOwnerEdit);
      return;
    }
    if (outcome.error === 'validation') {
      await replyEphemeral(interaction, outcome.message);
      return;
    }
    if (outcome.error === 'duplicate') {
      const { dateStr, timeStr, message } = outcome;
      await replyEphemeral(
        interaction,
        errorMessages.duplicateReminder(formatEventDate(dateStr), timeStr, message),
      );
      return;
    }

    const { updated, existing } = outcome;
    ctx.scheduleReminder(updated);

    const embed = buildReminderResultEmbed({
      title: '✏️ 提醒已更新',
      color: 0x5865f2,
      channelId: existing.channelId,
      message: updated.message,
      eventDate: updated.eventDate,
      eventTime: updated.eventTime,
      remindAt: updated.remindAt,
      footerId: targetId,
    });

    await replyEphemeral(interaction, { embeds: [embed] });
  },
};
