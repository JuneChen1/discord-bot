const {
  formatEventDate,
  getUserRemindDefault,
  validateReminderInput,
  isValidDateStr,
  addDaysUTC,
  parseDateUTC,
  formatDateStrUTC,
} = require('../lib/utils');
const { errorMessages } = require('../lib/errorHandle');
const { replyEphemeral } = require('../lib/replyHelpers');
const {
  generateReminderId,
  buildReminderRecord,
  isDuplicate,
  buildReminderResultEmbed,
  buildRecurrenceLabel,
} = require('../lib/reminderHelpers');

const typeLabels = { daily: '每天', weekly: '每週', monthly: '每月' };

module.exports = {
  name: 'remind-recurring',
  async execute(interaction, ctx) {
    const userId = interaction.user.id;
    const type = interaction.options.getString('type');
    const dateStr = interaction.options.getString('date');
    const message = interaction.options.getString('message');
    const timeStr = interaction.options.getString('time') ?? '';
    const remindTimeStr = interaction.options.getString('remind_time') ?? '';
    const remindOffsetDays = interaction.options.getInteger('remind_offset_days') ?? 1;
    const endDateStr = interaction.options.getString('end_date') ?? '';
    const count = interaction.options.getInteger('count');
    const targetChannel = ctx.getTargetChannel(interaction);

    if ((endDateStr && count !== null) || (!endDateStr && count === null)) {
      await replyEphemeral(interaction, errorMessages.recurringEndRequired);
      return;
    }
    if (remindOffsetDays < 0) {
      await replyEphemeral(interaction, errorMessages.invalidRecurrenceOffsetDays);
      return;
    }
    if (!isValidDateStr(dateStr)) {
      await replyEphemeral(interaction, errorMessages.invalidEventDateFormat);
      return;
    }
    if (endDateStr) {
      if (!isValidDateStr(endDateStr)) {
        await replyEphemeral(interaction, errorMessages.invalidRecurrenceEndDateFormat);
        return;
      }
      if (endDateStr < dateStr) {
        await replyEphemeral(interaction, errorMessages.recurrenceEndDateBeforeStart);
        return;
      }
    }
    if (count !== null && count < 1) {
      await replyEphemeral(interaction, errorMessages.invalidRecurrenceCount);
      return;
    }

    const remindDateStr = formatDateStrUTC(addDaysUTC(parseDateUTC(dateStr), -remindOffsetDays));

    // 只有在使用者沒有明確指定 remind_time 時才需要讀取個人預設設定
    const userDefault = remindTimeStr
      ? null
      : getUserRemindDefault(await ctx.loadUserSettings(), userId);

    const validated = validateReminderInput({
      dateStr,
      timeStr,
      remindDateStr,
      remindTimeRaw: remindTimeStr,
      defaultRemindHour: userDefault?.hour,
      defaultRemindMinute: userDefault?.minute,
    });
    if (validated.error) {
      await replyEphemeral(interaction, validated.error);
      return;
    }
    const { remindTimeDisplay, remindAt } = validated;

    const outcome = await ctx.withReminderLock(async () => {
      const reminders = await ctx.loadReminders();

      const duplicate = isDuplicate(reminders, {
        userId,
        eventDate: dateStr,
        eventTime: timeStr,
        message,
        remindTime: remindTimeDisplay,
        remindDate: remindDateStr,
      });
      if (duplicate) return { duplicate: true };

      const reminder = buildReminderRecord({
        id: generateReminderId(userId),
        userId,
        userName: interaction.user.username,
        channelId: targetChannel.id,
        message,
        eventDate: dateStr,
        eventTime: timeStr,
        remindTime: remindTimeDisplay,
        remindDate: remindDateStr,
        remindAt,
        recurrence: {
          type,
          remindOffsetDays,
          endDate: endDateStr || null,
          endCount: count,
          occurrenceIndex: 1,
        },
      });

      reminders.push(reminder);
      await ctx.saveReminders(reminders);
      return { reminder };
    });

    if (outcome.duplicate) {
      await replyEphemeral(
        interaction,
        errorMessages.duplicateReminder(formatEventDate(dateStr), timeStr, message),
      );
      return;
    }

    const { reminder } = outcome;
    ctx.scheduleReminder(reminder);

    const endSummary = endDateStr
      ? `至 ${formatEventDate(endDateStr)}`
      : `共 ${count} 次`;

    const embed = buildReminderResultEmbed({
      title: '✅ 週期提醒已設定',
      color: 0x57f287,
      channelId: targetChannel.id,
      message,
      eventDate: dateStr,
      eventTime: timeStr,
      remindAt,
      footerId: reminder.id,
    }).addFields({
      name: '🔁 週期',
      value: `${typeLabels[type]}・${endSummary}（${buildRecurrenceLabel(reminder.recurrence, dateStr)}）`,
    });

    await replyEphemeral(interaction, { embeds: [embed] });
  },
};
