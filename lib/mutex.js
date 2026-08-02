// 序列化同一資源的非同步操作，避免並發的「讀取→修改→寫入」互相覆蓋對方的寫入
// 用法：const withLock = createMutex(); await withLock(async () => { ... });
function createMutex() {
  let queue = Promise.resolve();
  return function withLock(fn) {
    if (typeof fn !== 'function') {
      throw new TypeError('withLock: fn 必須是函式');
    }
    // fn 同時作為 resolve/reject handler：無論前一個任務成功或失敗，都要序列執行到這次
    const run = queue.then(fn, fn);
    queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };
}

module.exports = { createMutex };
