const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { createMutex } = require('../lib/mutex');

describe('createMutex', () => {
  test('並發呼叫依序序列化，不會交錯執行', async () => {
    const withLock = createMutex();
    const events = [];

    // 用長短不一的 delay 模擬「後呼叫但先完成」的情境，確認 mutex 仍照呼叫順序執行
    function task(id, delayMs) {
      return withLock(async () => {
        events.push(`start-${id}`);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        events.push(`end-${id}`);
        return id;
      });
    }

    const results = await Promise.all([task('a', 20), task('b', 0), task('c', 0)]);

    assert.deepEqual(events, ['start-a', 'end-a', 'start-b', 'end-b', 'start-c', 'end-c']);
    assert.deepEqual(results, ['a', 'b', 'c']);
  });

  test('前一個 fn 拋出例外時，佇列不會卡住，後續呼叫仍會執行', async () => {
    const withLock = createMutex();

    await assert.rejects(
      withLock(async () => {
        throw new Error('boom');
      }),
      /boom/,
    );

    const after = await withLock(async () => 'ok');
    assert.equal(after, 'ok');
  });

  test('withLock 的回傳值對應到各自呼叫的結果，不會被其他呼叫覆蓋', async () => {
    const withLock = createMutex();
    const [a, b] = await Promise.all([withLock(async () => 1), withLock(async () => 2)]);
    assert.equal(a, 1);
    assert.equal(b, 2);
  });

  test('fn 不是函式時，立即拋出 TypeError（同步），不會排進佇列', () => {
    const withLock = createMutex();
    assert.throws(() => withLock('not a function'), TypeError);
  });

  test('不同的 mutex 實例互不影響，可同時執行', async () => {
    const lockA = createMutex();
    const lockB = createMutex();
    const events = [];

    const runA = lockA(async () => {
      events.push('a-start');
      await new Promise((resolve) => setTimeout(resolve, 20));
      events.push('a-end');
    });
    const runB = lockB(async () => {
      events.push('b-start');
      events.push('b-end');
    });

    await Promise.all([runA, runB]);

    // b 應該在 a 還沒結束前就完成，證明兩個 mutex 沒有互相排隊
    assert.deepEqual(events, ['a-start', 'b-start', 'b-end', 'a-end']);
  });

  test('模擬 reminders.json 併發寫入：兩次 add 都會被完整保留，不會互相覆蓋', async () => {
    // 模擬 index.js 的 loadReminders/saveReminders 對同一份記憶體資料做讀取→修改→寫入
    let store = [];
    async function load() {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return JSON.parse(JSON.stringify(store));
    }
    async function save(data) {
      await new Promise((resolve) => setTimeout(resolve, 5));
      store = data;
    }

    const withReminderLock = createMutex();
    async function addReminder(id) {
      await withReminderLock(async () => {
        const reminders = await load();
        reminders.push({ id });
        await save(reminders);
      });
    }

    await Promise.all([addReminder('x'), addReminder('y')]);

    assert.equal(store.length, 2);
    assert.deepEqual(
      store.map((r) => r.id).sort(),
      ['x', 'y'],
    );
  });
});
