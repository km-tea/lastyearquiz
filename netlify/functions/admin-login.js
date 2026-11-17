import { getSql } from '../lib/db.js';
import { json, readJson, notAllowed, handleErrors } from '../lib/http.js';
import { safeEqual, signToken } from '../lib/auth.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 관리자 코드만 입력하는 로그인. 코드는 환경변수 ADMIN_CODE (없으면 기본값 0227).
// 4자리 코드는 짧아서 무작위 대입에 약하므로, 최근 5분간 실패가 10번을 넘으면 잠시 로그인을 막는다.
// (학교 와이파이처럼 IP를 공유하는 환경을 고려해 IP가 아니라 전체 실패 횟수 기준)
const MAX_FAILURES = 10;

export default handleErrors(async (req) => {
  if (req.method !== 'POST') return notAllowed();

  const adminCode = process.env.ADMIN_CODE || '0227';
  const body = await readJson(req);
  const code = String(body?.code ?? '').trim();

  const sql = await getSql();
  const [{ n }] = await sql`
    SELECT count(*)::int AS n FROM admin_login_failures
    WHERE failed_at > now() - interval '5 minutes'`;
  if (n >= MAX_FAILURES) {
    return json({ error: '로그인 시도가 너무 많아요. 5분 뒤에 다시 시도해 주세요.' }, 429);
  }

  if (!code || !safeEqual(code, adminCode)) {
    await sql`INSERT INTO admin_login_failures DEFAULT VALUES`;
    await sleep(Number(process.env.LOGIN_FAIL_DELAY_MS ?? 500));
    return json({ error: '관리자 코드가 올바르지 않아요.' }, 401);
  }

  await sql`DELETE FROM admin_login_failures WHERE failed_at < now() - interval '1 day'`;
  return json({ token: signToken({ role: 'admin' }, 8 * 60 * 60) });
});

export const config = { path: '/api/admin/login' };
