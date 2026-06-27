const { parseRemindTime, getUserRemindDefault, formatHourMinute } = require('../lib/utils');
const { defaultRemindHour, defaultRemindMinute } = require('../lib/config.json');
const { errorMessages } = require('../lib/errorHandle');
const { replyEphemeral } = require('../lib/replyHelpers');

module.exports = {
  name: 'remind-default',
  async execute(interaction, ctx) {
    const userId = interaction.user.id;
    const timeInput = (interaction.options.getString('time') ?? '').trim() || null;
    const reset = interaction.options.getBoolean('reset') ?? false;

    if (timeInput && reset) {
      await replyEphemeral(interaction, errorMessages.timeAndResetConflict);
      return;
    }

    if (reset) {
      await ctx.withUserSettingsLock(async () => {
        const settings = await ctx.loadUserSettings();
        delete settings[userId];
        await ctx.saveUserSettings(settings);
      });
      await replyEphemeral(
        interaction,
        `✅ 已重設為系統預設提醒時間：\`${formatHourMinute(defaultRemindHour, defaultRemindMinute)}\`（台灣時間）。`,
      );
      return;
    }

    if (timeInput) {
      const parsed = parseRemindTime(timeInput);
      if (!parsed) {
        await replyEphemeral(interaction, errorMessages.invalidTimeFormat);
        return;
      }
      const display = formatHourMinute(parsed.hour, parsed.minute);
      await ctx.withUserSettingsLock(async () => {
        const settings = await ctx.loadUserSettings();
        settings[userId] = { remindHour: parsed.hour, remindMinute: parsed.minute };
        await ctx.saveUserSettings(settings);
      });
      await replyEphemeral(
        interaction,
        `✅ 你的個人預設提醒時間已設定為 \`${display}\`（台灣時間），\`/remind\` 未指定 \`remind_time\` 時將套用此設定。`,
      );
      return;
    }

    const settings = await ctx.loadUserSettings();
    const current = getUserRemindDefault(settings, userId);
    const display = formatHourMinute(current.hour, current.minute);
    const isCustom = Object.hasOwn(settings, userId);
    await replyEphemeral(
      interaction,
      `⏰ 你目前的個人預設提醒時間：\`${display}\`（台灣時間）${isCustom ? '' : '　（尚未自訂，使用系統預設）'}`,
    );
  },
};
