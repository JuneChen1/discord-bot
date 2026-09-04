const jwt = require('jsonwebtoken');
const crypto = require('crypto');

// /reminders 每次都會重新產生連結，7 天效期足夠涵蓋使用者在舊訊息點回去查看的情境
const tokenTtl = '7d';
// 明確限制演算法，避免未來誤簽發其他演算法的 token 時被 alg 混淆攻擊利用
const algorithm = 'HS256';

const secret = process.env.WEB_TOKEN_SECRET || crypto.randomBytes(32).toString('hex');
if (!process.env.WEB_TOKEN_SECRET) {
  console.warn(
    '[webToken] 未設定 WEB_TOKEN_SECRET，已使用臨時亂數密鑰；服務重啟後所有舊連結會失效',
  );
}

// 產生含 userId、userName 的簽章 token（JWT），供 /reminders 網頁版連結使用
function createReminderToken(userId, userName) {
  return jwt.sign({ userId, userName }, secret, { expiresIn: tokenTtl, algorithm });
}

// 驗證 token，回傳 { userId, userName }；格式錯誤、簽章不符或已過期一律回傳 null
function verifyReminderToken(token) {
  if (typeof token !== 'string') return null;
  try {
    const { userId, userName } = jwt.verify(token, secret, { algorithms: [algorithm] });
    if (!userId) return null;
    return { userId, userName };
  } catch {
    return null;
  }
}

module.exports = { createReminderToken, verifyReminderToken };
