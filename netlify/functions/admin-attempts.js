import { getSql } from '../lib/db.js';
import { json, notAllowed, unauthorized, handleErrors } from '../lib/http.js';
import { requireAdmin } from '../lib/auth.js';

// 전체 참여 현황 (학년, 반, 번호, 상태만 — 이름 등 개인정보는 저장하지 않음)
export default handleErrors(async (req) => {
  if (req.method !== 'GET') return notAllowed();
  if (!requireAdmin(req)) return unauthorized();

  const sql = await getSql();
  const attempts = await sql`
    SELECT grade, class_no, number, status, score, attempt_count, submitted_at
    FROM attempts
    ORDER BY grade, class_no, number`;
  return json({ attempts });
});

export const config = { path: '/api/admin/attempts' };
