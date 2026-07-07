const { EmbedBuilder, MessageFlags } = require('discord.js');
const {
  toMinutes,
  formatEventDate,
  formatHourMinute,
  parseCSVLine,
  parseRemindTime,
  getUserRemindDefault,
  isValidDateStr,
  calcReminderTime,
  addDaysUTC,
  parseDateUTC,
  formatDateStrUTC,
  recurrenceTypes,
} = require('../lib/utils');
const { errorMessages } = require('../lib/errorHandle');
const { replyEphemeral } = require('../lib/replyHelpers');
const {
  generateReminderId,
  buildReminderRecord,
  isDuplicate,
  truncateList,
} = require('../lib/reminderHelpers');

module.exports = {
  name: 'remind-import',
  async execute(interaction, ctx) {
    const userId = interaction.user.id;
    const attachment = interaction.options.getAttachment('file');

    if (!attachment.name.endsWith('.csv')) {
      await replyEphemeral(interaction, errorMessages.invalidCsvFile);
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    let text;
    try {
      const res = await fetch(attachment.url);
      text = await res.text();
    } catch {
      await interaction.editReply(errorMessages.csvReadFailed);
      return;
    }

    // 去掉 UTF-8 BOM（Excel 存出的 CSV 會帶這個）
    text = text.replace(/^\uFEFF/, '');
    const lines = text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l);
    if (lines.length === 0) {
      await interaction.editReply(errorMessages.csvEmpty);
      return;
    }

    // 若第一行是 header 則跳過
    const dataLines = lines[0].toLowerCase().startsWith('date') ? lines.slice(1) : lines;
    if (dataLines.length === 0) {
      await interaction.editReply(errorMessages.csvHeaderOnly);
      return;
    }

    const targetChannel = ctx.getTargetChannel(interaction);

    const success = [];
    const failed = [];

    // 個人預設提醒時間僅在有資料列缺少 remind_time 時才需要讀取
    let userDefault = null;
    const getUserDefault = async () => {
      if (!userDefault) userDefault = getUserRemindDefault(await ctx.loadUserSettings(), userId);
      return userDefault;
    };

    const { toSchedule } = await ctx.withReminderLock(async () => {
      const reminders = await ctx.loadReminders();
      const now = Date.now();
      const toSchedule = [];

      for (let i = 0; i < dataLines.length; i++) {
        const lineNumber = i + 1;
        const fields = parseCSVLine(dataLines[i]);
        if (fields === null) {
          failed.push(errorMessages.csvLineQuoteError(lineNumber));
          continue;
        }
        const dateStr = (fields[0] ?? '').trim();
        const message = (fields[1] ?? '').trim();
        const timeStr = (fields[2] ?? '').trim();
        const remindTimeRaw = (fields[3] ?? '').trim();
        const remindDateRaw = (fields[4] ?? '').trim();
        const recurrenceTypeRaw = (fields[5] ?? '').trim();
        const remindOffsetDaysRaw = (fields[6] ?? '').trim();
        const recurrenceEndDateRaw = (fields[7] ?? '').trim();
        const recurrenceCountRaw = (fields[8] ?? '').trim();

        if (!dateStr || !message) {
          failed.push(errorMessages.csvLineMissingFields(lineNumber));
          continue;
        }

        if (!isValidDateStr(dateStr)) {
          failed.push(errorMessages.csvLineInvalidDate(lineNumber, dateStr));
          continue;
        }

        // recurrenceTypeRaw 有值代表這是週期提醒（type/remind_offset_days/end_date/count 欄位取代 remind_date）
        let recurrence = null;
        let remindDateForRecord = remindDateRaw;

        if (recurrenceTypeRaw) {
          if (!recurrenceTypes.includes(recurrenceTypeRaw)) {
            failed.push(errorMessages.csvLineInvalidRecurrenceType(lineNumber, recurrenceTypeRaw));
            continue;
          }
          if (
            (recurrenceEndDateRaw && recurrenceCountRaw) ||
            (!recurrenceEndDateRaw && !recurrenceCountRaw)
          ) {
            failed.push(errorMessages.csvLineRecurrenceEndRequired(lineNumber));
            continue;
          }
          if (recurrenceEndDateRaw && !isValidDateStr(recurrenceEndDateRaw)) {
            failed.push(
              errorMessages.csvLineInvalidRecurrenceEndDate(lineNumber, recurrenceEndDateRaw),
            );
            continue;
          }
          if (recurrenceEndDateRaw && recurrenceEndDateRaw < dateStr) {
            failed.push(errorMessages.csvLineRecurrenceEndDateBeforeStart(lineNumber));
            continue;
          }
          let recurrenceCount = null;
          if (recurrenceCountRaw) {
            recurrenceCount = Number(recurrenceCountRaw);
            if (!Number.isInteger(recurrenceCount) || recurrenceCount < 1) {
              failed.push(errorMessages.csvLineInvalidRecurrenceCount(lineNumber, recurrenceCountRaw));
              continue;
            }
          }
          let remindOffsetDays = 1;
          if (remindOffsetDaysRaw) {
            remindOffsetDays = Number(remindOffsetDaysRaw);
            if (!Number.isInteger(remindOffsetDays) || remindOffsetDays < 0) {
              failed.push(
                errorMessages.csvLineInvalidRecurrenceOffsetDays(lineNumber, remindOffsetDaysRaw),
              );
              continue;
            }
          }
          remindDateForRecord = formatDateStrUTC(
            addDaysUTC(parseDateUTC(dateStr), -remindOffsetDays),
          );
          recurrence = {
            type: recurrenceTypeRaw,
            remindOffsetDays,
            endDate: recurrenceEndDateRaw || null,
            endCount: recurrenceCount,
            occurrenceIndex: 1,
          };
        } else {
          if (remindDateRaw && !isValidDateStr(remindDateRaw)) {
            failed.push(errorMessages.csvLineInvalidRemindDate(lineNumber, remindDateRaw));
            continue;
          }

          if (remindDateRaw && remindDateRaw > dateStr) {
            failed.push(
              errorMessages.csvLineRemindDateAfterEventDate(
                lineNumber,
                formatEventDate(remindDateRaw),
                formatEventDate(dateStr),
              ),
            );
            continue;
          }
        }

        const defaults = remindTimeRaw ? null : await getUserDefault();
        const parsedRemindTime = parseRemindTime(
          remindTimeRaw || null,
          defaults?.hour,
          defaults?.minute,
        );
        if (!parsedRemindTime) {
          failed.push(errorMessages.csvLineInvalidRemindTime(lineNumber, remindTimeRaw));
          continue;
        }

        const remindTimeDisplay = formatHourMinute(parsedRemindTime.hour, parsedRemindTime.minute);

        if (
          remindDateForRecord &&
          remindDateForRecord === dateStr &&
          timeStr &&
          toMinutes(remindTimeDisplay) >= toMinutes(timeStr)
        ) {
          failed.push(
            errorMessages.csvLineRemindTimeAfterEventTime(
              lineNumber,
              formatEventDate(dateStr),
              remindTimeDisplay,
              timeStr,
            ),
          );
          continue;
        }

        // dateStr 與 remindDateForRecord（若有提供）已在上方驗證過，calcReminderTime 不會再回傳 null
        const remindAt = calcReminderTime(
          dateStr,
          parsedRemindTime.hour,
          parsedRemindTime.minute,
          remindDateForRecord || null,
        );

        if (remindAt <= now) {
          failed.push(errorMessages.csvLineRemindTimeExpired(lineNumber, formatEventDate(dateStr)));
          continue;
        }

        const duplicate = isDuplicate(reminders, {
          userId,
          eventDate: dateStr,
          eventTime: timeStr,
          message,
          remindTime: remindTimeDisplay,
          remindDate: remindDateForRecord,
        });
        if (duplicate) {
          failed.push(
            errorMessages.csvLineDuplicate(lineNumber, formatEventDate(dateStr), timeStr, message),
          );
          continue;
        }

        const reminder = buildReminderRecord({
          id: generateReminderId(userId, i),
          userId,
          userName: interaction.user.username,
          channelId: targetChannel.id,
          message,
          eventDate: dateStr,
          eventTime: timeStr,
          remindTime: remindTimeDisplay,
          remindDate: remindDateForRecord,
          remindAt,
          recurrence,
        });

        reminders.push(reminder);
        toSchedule.push(reminder);
        const eventDisplay = timeStr
          ? `${formatEventDate(dateStr)} ${timeStr}`
          : formatEventDate(dateStr);
        success.push(`\`${eventDisplay}\`　${message}`);
      }

      await ctx.saveReminders(reminders);
      return { toSchedule };
    });

    toSchedule.forEach(ctx.scheduleReminder);

    const color = failed.length === 0 ? 0x57f287 : success.length === 0 ? 0xed4245 : 0xfee75c;

    const embed = new EmbedBuilder().setTitle('📥 批次匯入結果').setColor(color);

    if (success.length > 0) {
      embed.addFields({ name: `✅ 成功 ${success.length} 筆`, value: truncateList(success) });
    }
    if (failed.length > 0) {
      embed.addFields({ name: `❌ 失敗 ${failed.length} 筆`, value: truncateList(failed) });
    }

    await interaction.editReply({ embeds: [embed] });
  },
};
