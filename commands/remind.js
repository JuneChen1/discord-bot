const { formatEventDate, getUserRemindDefault, validateReminderInput } = require('../lib/utils');
const { errorMessages } = require('../lib/errorHandle');
const { replyEphemeral } = require('../lib/replyHelpers');
const {
  generateReminderId,
  buildReminderRecord,
  isDuplicate,
  buildReminderResultEmbed,
} = require('../lib/reminderHelpers');

module.exports = {
  name: 'remind',
  async execute(interaction, ctx) {
    const userId = interaction.user.id;
    const dateStr = interaction.options.getString('date');
    const message = interaction.options.getString('message');
    const timeStr = interaction.options.getString('time') ?? '';
    const remindTimeStr = interaction.options.getString('remind_time') ?? '';
    const remindDateStr = interaction.options.getString('remind_date') ?? '';
    const targetChannel = ctx.getTargetChannel(interaction);

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

    const embed = buildReminderResultEmbed({
      title: '✅ 提醒已設定',
      color: 0x57f287,
      channelId: targetChannel.id,
      message,
      eventDate: dateStr,
      eventTime: timeStr,
      remindAt,
      footerId: reminder.id,
    });

    await replyEphemeral(interaction, { embeds: [embed] });
  },
};
