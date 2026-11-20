import { getSql } from '../lib/db.js';
import { json, readJson, notAllowed, handleErrors } from '../lib/http.js';
import { safeEqual, signToken } from '../lib/auth.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 관리자 코드만 입력하는 로그인. 코드는 환경변수 ADMIN_CODE (없으면 기본값 0227).
//
// 4자리 코드는 짧아서 무작위 대입에 약하므로 로그인 실패 횟수를 제한한다.
//  · 기기마다 따로 센다: 최근 5분 동안 같은 기기에서 10번 틀리면 그 기기만 5분간 막힌다.
//    다른 기기(예: 선생님 기기)는 영향이 없다. 기기는 브라우저가 처음 접속할 때 만들어 저장해 두는
//    임의 번호(deviceId)로 구분한다. 번호가 없거나 형식이 다르면 같은 네트워크(IP)를 한 기기로 본다.
//  · 기기 번호는 사용자가 바꿀 수 있으므로, 번호를 계속 바꿔 가며 대입하는 것을 막는 안전장치로
//    같은 네트워크(IP)에서 나온 실패의 합계도 따로 센다. 학교처럼 여러 기기가 IP를 공유할 수 있어서
//    한도를 넉넉하게(30번) 잡았다.
const MAX_FAILURES_PER_DEVICE = 10;
const MAX_FAILURES_PER_IP = 30;
const WINDOW_MINUTES = 5;
const DEVICE_ID_FORMAT = /^[A-Za-z0-9-]{16,64}$/;

// 실패 기록에 기기/네트워크 칸이 없던 예전 DB도 그대로 쓸 수 있도록, 처음 한 번만 칸을 만들어 둔다.
// (db/schema.sql을 다시 실행했다면 이미 있어서 아무것도 하지 않는다.)
let columnsReady = false;
async function ensureColumns(sql) {
  if (columnsReady) return;
  const have = await sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'admin_login_failures' AND column_name IN ('device', 'ip')`;
  if (have.length < 2) {
    await sql`ALTER TABLE admin_login_failures ADD COLUMN IF NOT EXISTS device TEXT, ADD COLUMN IF NOT EXISTS ip TEXT`;
  }
  columnsReady = true;
}

function clientIp(req, ctx) {
  const v = ctx?.ip
    || req.headers.get('x-nf-client-connection-ip')
    || (req.headers.get('x-forwarded-for') || '').split(',')[0]
    || 'unknown';
  return String(v).trim().slice(0, 64) || 'unknown';
}

const minutes = (sec) => Math.max(1, Math.ceil(sec / 60));

export default handleErrors(async (req, ctx) => {
  if (req.method !== 'POST') return notAllowed();

  const adminCode = process.env.ADMIN_CODE || '0227';
  const body = await readJson(req);
  const code = String(body?.code ?? '').trim();
  const ip = clientIp(req, ctx);
  const rawDevice = String(body?.deviceId ?? '');
  const device = DEVICE_ID_FORMAT.test(rawDevice) ? `d:${rawDevice}` : `ip:${ip}`;

  const sql = await getSql();
  await ensureColumns(sql);

  // 최근 5분 실패 중 이 기기 또는 이 네트워크의 것 (최근 것부터). wait_s = 그 기록이 5분 창에서 빠질 때까지 남은 초
  const recent = await sql`
    SELECT device, ip,
           GREATEST(1, ceil(extract(epoch FROM (failed_at + interval '5 minutes' - now())))::int) AS wait_s
    FROM admin_login_failures
    WHERE failed_at > now() - interval '5 minutes'
      AND (device = ${device} OR ip = ${ip})
    ORDER BY failed_at DESC`;
  const deviceFails = recent.filter((r) => r.device === device);
  const ipFails = recent.filter((r) => r.ip === ip);

  // 막혔다면, 한도에 걸린 기록 중 가장 오래된 것이 창에서 빠질 때(= 다시 시도할 수 있는 때)까지의 시간을 알려 준다.
  if (deviceFails.length >= MAX_FAILURES_PER_DEVICE) {
    const wait = Number(deviceFails[MAX_FAILURES_PER_DEVICE - 1].wait_s);
    return json({ error: `이 기기에서 로그인 시도가 너무 많아요. ${minutes(wait)}분 뒤에 다시 시도해 주세요.`, retryAfterSec: wait }, 429);
  }
  if (ipFails.length >= MAX_FAILURES_PER_IP) {
    const wait = Number(ipFails[MAX_FAILURES_PER_IP - 1].wait_s);
    return json({ error: `같은 네트워크에서 로그인 시도가 너무 많아요. ${minutes(wait)}분 뒤에 다시 시도해 주세요.`, retryAfterSec: wait }, 429);
  }

  if (!code || !safeEqual(code, adminCode)) {
    await sql`INSERT INTO admin_login_failures (device, ip) VALUES (${device}, ${ip})`;
    await sleep(Number(process.env.LOGIN_FAIL_DELAY_MS ?? 500));
    const remaining = MAX_FAILURES_PER_DEVICE - (deviceFails.length + 1);
    let message = '관리자 코드가 올바르지 않아요.';
    if (remaining <= 0) message += ` 이 기기는 ${WINDOW_MINUTES}분 뒤에 다시 시도할 수 있어요.`;
    else if (remaining <= 3) message += ` (이 기기에서 ${remaining}번 더 시도할 수 있어요)`;
    return json({ error: message }, 401);
  }

  // 로그인에 성공하면 이 기기의 실패 기록을 지우고(앞서 오타로 쌓인 횟수가 남지 않게), 하루 지난 기록도 정리한다.
  await sql`DELETE FROM admin_login_failures WHERE device = ${device} OR failed_at < now() - interval '1 day'`;
  return json({ token: signToken({ role: 'admin' }, 8 * 60 * 60) });
});

export const config = { path: '/api/admin/login' };
