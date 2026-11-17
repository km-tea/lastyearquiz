import { getSql } from '../lib/db.js';
import { json, readJson, notAllowed, handleErrors } from '../lib/http.js';
import { parseSeat, ALREADY_MESSAGE } from '../lib/config.js';
import { loadPool, countNonsense } from '../lib/questions.js';
import { pickQuestions } from '../lib/pick.js';

// 1단계: 번호 확인 (참여 기록은 만들지 않음)
//  · 수료한 학생만 막고, 미수료/중간 이탈 학생은 몇 번이든 다시 도전할 수 있다.
export default handleErrors(async (req) => {
  if (req.method !== 'POST') return notAllowed();

  const seat = parseSeat(await readJson(req));
  if (!seat) return json({ error: '학년, 반, 번호를 다시 확인해 주세요.', code: 'BAD_SEAT' }, 400);

  const sql = await getSql();
  const rows = await sql`
    SELECT status FROM attempts
    WHERE grade = ${seat.grade} AND class_no = ${seat.classNo} AND number = ${seat.number}`;
  if (rows[0]?.status === 'completed') {
    return json({ error: ALREADY_MESSAGE, code: 'ALREADY' }, 409);
  }

  const pool = await loadPool(sql, seat.grade);
  if (!pickQuestions(pool)) {
    return json({ error: '아직 이 학년의 문제가 준비되지 않았어요. 선생님께 알려 주세요.', code: 'NO_QUESTIONS' }, 503);
  }
  const nonsenseAvailable = (await countNonsense(sql, seat.grade)) > 0;
  return json({ ok: true, nonsenseAvailable });
});

export const config = { path: '/api/student/check' };
