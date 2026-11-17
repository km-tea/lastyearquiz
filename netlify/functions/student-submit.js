import { getSql, intArrayLiteral, toIntArray } from '../lib/db.js';
import { json, readJson, notAllowed, handleErrors } from '../lib/http.js';
import { verifyToken } from '../lib/auth.js';

const TOTAL = 5;

// 3단계: 답안 제출 → 서버에서 채점 (5문제 모두 정답이면 수료)
export default handleErrors(async (req) => {
  if (req.method !== 'POST') return notAllowed();

  const body = await readJson(req);
  const payload = verifyToken(body?.token);
  if (!payload) return json({ error: '시간이 지났거나 올바르지 않은 접근이에요.', code: 'BAD_TOKEN' }, 401);

  const answers = body?.answers;
  if (!Array.isArray(answers) || answers.length !== TOTAL || !answers.every((a) => Number.isInteger(a))) {
    return json({ error: '5문제에 모두 답해 주세요.' }, 400);
  }

  const sql = await getSql();
  const [attempt] = await sql`
    SELECT id, status, question_ids, attempt_count FROM attempts WHERE id = ${payload.aid}`;
  if (!attempt) return json({ error: '참여 기록을 찾을 수 없어요.' }, 404);
  // 새 도전을 시작했거나 이미 제출한 경우
  if (attempt.status !== 'started' || attempt.attempt_count !== payload.run) {
    return json({ error: '이미 제출했거나 새로 시작한 퀴즈예요. 처음 화면에서 다시 시작해 주세요.', code: 'SUBMITTED' }, 409);
  }

  const ids = toIntArray(attempt.question_ids);
  const rows = await sql`
    SELECT id, answer FROM questions WHERE id = ANY(${intArrayLiteral(ids)}::int[])`;
  const answerById = new Map(rows.map((r) => [r.id, r.answer]));

  let score = 0;
  ids.forEach((qid, i) => {
    if (answerById.get(qid) === answers[i]) score += 1;
  });
  const completed = score === TOTAL;

  const updated = await sql`
    UPDATE attempts
    SET status = ${completed ? 'completed' : 'failed'}, score = ${score}, submitted_at = now()
    WHERE id = ${attempt.id} AND status = 'started' AND attempt_count = ${payload.run}
    RETURNING id`;
  if (!updated.length) {
    return json({ error: '이미 제출했거나 새로 시작한 퀴즈예요. 처음 화면에서 다시 시작해 주세요.', code: 'SUBMITTED' }, 409);
  }

  return json({ score, total: TOTAL, completed });
});

export const config = { path: '/api/student/submit' };
