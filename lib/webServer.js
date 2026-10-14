const express = require('express');
const { verifyReminderToken } = require('./webToken');
const { renderRemindersPage } = require('./reminderWebPage');
const { buildRemindersCsv } = require('./reminderCsv');
const { defaultWebPort } = require('./config.json');

// 驗證 token 並載入該使用者自己的提醒後交給 respond 回應；token 無效回 401，其餘例外回 500（不外洩內部資訊）
function reminderRoute(ctx, routeName, respond) {
  return async (req, res) => {
    try {
      const verified = verifyReminderToken(req.query.token);
      if (!verified) {
        res.status(401).send('連結無效或已過期，請到 Discord 重新使用 /reminders 指令取得新連結。');
        return;
      }
      const reminders = (await ctx.loadReminders()).filter((r) => r.userId === verified.userId);
      respond(res, { reminders, userName: verified.userName, token: req.query.token });
    } catch (err) {
      console.error(`[webServer] ${routeName} 處理失敗：`, err);
      res.status(500).send('伺服器發生錯誤，請稍後再試。');
    }
  };
}

// 唯讀提醒網頁：/reminders?token=xxx，token 由 lib/webToken.js 簽發，僅能看到 token 綁定的使用者自己的提醒；
// /reminders.csv?token=xxx 提供同一份清單的 CSV 下載
function startWebServer(ctx) {
  const app = express();

  app.get(
    '/reminders',
    reminderRoute(ctx, '/reminders', (res, { reminders, userName, token }) => {
      const csvHref = `/reminders.csv?token=${encodeURIComponent(token)}`;
      res.type('html').send(renderRemindersPage(reminders, userName, csvHref));
    }),
  );

  app.get(
    '/reminders.csv',
    reminderRoute(ctx, '/reminders.csv', (res, { reminders }) => {
      res.attachment('reminders.csv').send(buildRemindersCsv(reminders));
    }),
  );

  const port = process.env.PORT || defaultWebPort;
  return app.listen(port, () => {
    console.log(`Web server 已啟動，監聽 port ${port}`);
  });
}

module.exports = { startWebServer };
