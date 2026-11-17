import { getSql } from '../lib/db.js';
import { json, readJson, notAllowed, unauthorized, handleErrors } from '../lib/http.js';
import { requireAdmin } from '../lib/auth.js';
import { parseSeat } from '../lib/config.js';

// 재참여 승인: 수료한 학생의 기록을 삭제해 다시 참여할 수 있게 한다.
// (미수료 학생은 승인 없이도 계속 도전할 수 있다.)
export default handleErrors(async (req) => {
  if (req.method !== 'POST') return notAllowed();
  if (!requireAdmin(req)) return unauthorized();

  const seat = parseSeat(await readJson(req));
  if (!seat) return json({ error: '학년, 반, 번호를 확인해 주세요.' }, 400);

  const sql = await getSql();
  const removed = await sql`
    DELETE FROM attempts
    WHERE grade = ${seat.grade} AND class_no = ${seat.classNo} AND number = ${seat.number}
    RETURNING id`;
  return json({ ok: true, removed: removed.length });
});

export const config = { path: '/api/admin/reset' };
