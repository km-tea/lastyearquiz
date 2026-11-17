import crypto from 'node:crypto';

function secret() {
  const s = process.env.TOKEN_SECRET;
  if (!s || s.length < 16) throw new Error('TOKEN_SECRET 환경변수(16자 이상)가 필요합니다.');
  return s;
}

const hmac = (body) => crypto.createHmac('sha256', secret()).update(body).digest();

// 서명된 토큰: base64url(payload).base64url(hmac)
export function signToken(payload, ttlSec) {
  const body = Buffer.from(
    JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + ttlSec }),
  ).toString('base64url');
  return `${body}.${hmac(body).toString('base64url')}`;
}

export function verifyToken(token) {
  if (typeof token !== 'string') return null;
  const [body, sig, extra] = token.split('.');
  if (!body || !sig || extra !== undefined) return null;
  const given = Buffer.from(sig, 'base64url');
  const expected = hmac(body);
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

export function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

// 관리자 요청인지 확인 (Authorization: Bearer <token>)
export function requireAdmin(req) {
  const m = (req.headers.get('authorization') || '').match(/^Bearer (.+)$/);
  const payload = m ? verifyToken(m[1]) : null;
  return payload && payload.role === 'admin' ? payload : null;
}
