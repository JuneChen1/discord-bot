const express = require('express');
const { verifyReminderToken } = require('./webToken');
const { renderRemindersPage } = require('./reminderWebPage');
const { defaultWebPort } = require('./config.json');

// 唯讀提醒網頁：/reminders?token=xxx，token 由 lib/webToken.js 簽發，僅能看到 token 綁定的使用者自己的提醒
function startWebServer(ctx) {
  const app = express();

  app.get('/reminders', async (req, res) => {
    try {
      const verified = verifyReminderToken(req.query.token);
      if (!verified) {
        res.status(401).send('連結無效或已過期，請到 Discord 重新使用 /reminders 指令取得新連結。');
        return;
      }
      const { userId, userName } = verified;
      const reminders = (await ctx.loadReminders()).filter((r) => r.userId === userId);
      res.type('html').send(renderRemindersPage(reminders, userName));
    } catch (err) {
      console.error('[webServer] /reminders 處理失敗：', err);
      res.status(500).send('伺服器發生錯誤，請稍後再試。');
    }
  });

  const port = process.env.PORT || defaultWebPort;
  return app.listen(port, () => {
    console.log(`Web server 已啟動，監聽 port ${port}`);
  });
}

module.exports = { startWebServer };
