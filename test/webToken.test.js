const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

process.env.WEB_TOKEN_SECRET = 'test-secret';
const { createReminderToken, verifyReminderToken } = require('../lib/webToken');

describe('webToken', () => {
  test('建立的 token 可驗證回原本的 userId 與 userName', () => {
    const token = createReminderToken('user-123', 'june');
    assert.deepEqual(verifyReminderToken(token), { userId: 'user-123', userName: 'june' });
  });

  test('格式錯誤的 token 回傳 null', () => {
    assert.equal(verifyReminderToken('not-a-token'), null);
    assert.equal(verifyReminderToken(''), null);
    assert.equal(verifyReminderToken(undefined), null);
  });

  test('簽章被竄改時回傳 null', () => {
    const token = createReminderToken('user-123', 'june');
    const [header, payload] = token.split('.');
    assert.equal(verifyReminderToken(`${header}.${payload}.tampered-signature`), null);
  });

  test('payload 被竄改（換成別人的 userId）時，簽章不符回傳 null', () => {
    const tokenA = createReminderToken('user-a', 'a');
    const tokenB = createReminderToken('user-b', 'b');
    const [headerA, , sigA] = tokenA.split('.');
    const [, payloadB] = tokenB.split('.');
    assert.equal(verifyReminderToken(`${headerA}.${payloadB}.${sigA}`), null);
  });

  test('已過期的 token 回傳 null', () => {
    const originalNow = Date.now;
    Date.now = () => originalNow() - 8 * 24 * 60 * 60 * 1000; // 簽發一個 8 天前的 token（TTL 為 7 天）
    const token = createReminderToken('user-123', 'june');
    Date.now = originalNow;

    assert.equal(verifyReminderToken(token), null);
  });
});
