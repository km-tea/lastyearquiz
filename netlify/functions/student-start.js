import { getSql, intArrayLiteral } from '../lib/db.js';
import { json, readJson, notAllowed, handleErrors } from '../lib/http.js';
import { parseSeat, ALREADY_MESSAGE } from '../lib/config.js';
import { loadPool, loadNonsense, toStudentQuestion, toNonsenseQuestion } from '../lib/questions.js';
import { pickQuestions } from '../lib/pick.js';
import { signToken } from '../lib/auth.js';

// 2단계: 도전 기록 생성(또는 갱신) + 문제 출제.
//  · 기록이 없으면 새로 만들고, 수료하지 못한 기록이 있으면 새 도전으로 덮어쓴다(attempt_count + 1).
//  · 수료 기록이 있으면 WHERE 조건에 걸려 아무것도 갱신되지 않아 차단된다. (한 문장으로 처리되어 동시 요청에도 안전)
export default handleErrors(async (req) => {
  if (req.method !== 'POST') return notAllowed();

  const body = await readJson(req);
  const seat = parseSeat(body);
  if (!seat) return json({ error: '학년, 반, 번호를 다시 확인해 주세요.', code: 'BAD_SEAT' }, 400);
  const wantNonsense = body?.wantNonsense === true;

  const sql = await getSql();
  const picked = pickQuestions(await loadPool(sql, seat.grade));
  if (!picked) {
    return json({ error: '아직 이 학년의 문제가 준비되지 않았어요. 선생님께 알려 주세요.', code: 'NO_QUESTIONS' }, 503);
  }

  const ids = intArrayLiteral(picked.map((q) => q.id));
  const rows = await sql`
    INSERT INTO attempts (grade, class_no, number, question_ids)
    VALUES (${seat.grade}, ${seat.classNo}, ${seat.number}, ${ids}::int[])
    ON CONFLICT (grade, class_no, number) DO UPDATE
      SET status = 'started',
          question_ids = EXCLUDED.question_ids,
          score = NULL,
          submitted_at = NULL,
          started_at = now(),
          attempt_count = attempts.attempt_count + 1
      WHERE attempts.status <> 'completed'
    RETURNING id, attempt_count`;
  if (!rows.length) return json({ error: ALREADY_MESSAGE, code: 'ALREADY' }, 409);

  // 토큰에 도전 회차(run)를 넣어, 이전 도전의 토큰으로는 제출할 수 없게 한다.
  const token = signToken({ aid: rows[0].id, run: rows[0].attempt_count }, 60 * 60);
  const nonsense = wantNonsense ? (await loadNonsense(sql, seat.grade)).map(toNonsenseQuestion) : [];
  return json({ token, questions: picked.map(toStudentQuestion), nonsense });
});

export const config = { path: '/api/student/start' };
