const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');

process.env.WEB_TOKEN_SECRET = 'test-secret';
process.env.PORT = '0'; // 交給 OS 分配空閒 port，避免與其他測試/服務衝突

const { startWebServer } = require('../lib/webServer');
const { createReminderToken } = require('../lib/webToken');

describe('webServer /reminders', () => {
  let server;
  let baseUrl;
  const reminders = [
    { id: '1', userId: 'u1', eventDate: '20260101', remindAt: Date.now() + 100000, message: '我的提醒' },
    { id: '2', userId: 'u2', eventDate: '20260102', remindAt: Date.now() + 100000, message: '別人的提醒' },
  ];
  const ctx = { loadReminders: async () => reminders };

  before(() => {
    server = startWebServer(ctx);
    baseUrl = `http://localhost:${server.address().port}`;
  });

  after(() => {
    server.close();
  });

  test('有效 token → 200，且只回傳該 userId 自己的提醒', async () => {
    const token = createReminderToken('u1', 'june');
    const res = await fetch(`${baseUrl}/reminders?token=${token}`);
    const body = await res.text();
    assert.equal(res.status, 200);
    assert.equal(body.includes('我的提醒'), true);
    assert.equal(body.includes('別人的提醒'), false);
  });

  test('缺少 token → 401', async () => {
    const res = await fetch(`${baseUrl}/reminders`);
    assert.equal(res.status, 401);
  });

  test('無效 token → 401', async () => {
    const res = await fetch(`${baseUrl}/reminders?token=not-a-real-token`);
    assert.equal(res.status, 401);
  });

  test('ctx.loadReminders 拋出例外時 → 500，不外洩堆疊資訊', async () => {
    const brokenCtx = {
      loadReminders: async () => {
        throw new Error('boom: internal secret path');
      },
    };
    const brokenServer = startWebServer(brokenCtx);
    try {
      const brokenBaseUrl = `http://localhost:${brokenServer.address().port}`;
      const token = createReminderToken('u1', 'june');
      const res = await fetch(`${brokenBaseUrl}/reminders?token=${token}`);
      const body = await res.text();
      assert.equal(res.status, 500);
      assert.equal(body.includes('boom'), false);
    } finally {
      brokenServer.close();
    }
  });
});
