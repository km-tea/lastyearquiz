import { getSql } from '../lib/db.js';
import { json, readJson, notAllowed, unauthorized, handleErrors } from '../lib/http.js';
import { requireAdmin } from '../lib/auth.js';
import { validateQuestion } from '../lib/config.js';

// GET ?grade=N : 그 학년의 일반 문항 목록 (grade 없이 부르면 넌센스 포함 전체) / POST : 문항 1개 추가 / DELETE ?id=N : 문항 삭제(비활성화)
// 넌센스 문항은 모든 학년 공통이라 학년 없이 등록한다.
// 목록은 최근에 만든 문항이 먼저 나온다. (엑셀로 한 번에 올린 문항은 같은 시각이라, 묶음 안에서는 엑셀에 적은 순서를 유지)
export default handleErrors(async (req) => {
  if (!requireAdmin(req)) return unauthorized();
  const sql = await getSql();
  const url = new URL(req.url);

  if (req.method === 'GET') {
    const grade = Number(url.searchParams.get('grade'));
    const questions = Number.isInteger(grade) && grade >= 1 && grade <= 6
      ? await sql`
          SELECT id, grade, category, type, subject, body, choices, answer
          FROM questions WHERE grade = ${grade} AND category = 'regular' AND is_active = TRUE ORDER BY created_at DESC, id`
      : await sql`
          SELECT id, grade, category, type, subject, body, choices, answer
          FROM questions WHERE is_active = TRUE ORDER BY created_at DESC, id`;
    return json({ questions });
  }

  if (req.method === 'POST') {
    const { value, error } = validateQuestion(await readJson(req));
    if (error) return json({ error }, 400);
    const choices = value.choices ? JSON.stringify(value.choices) : null;
    const [row] = await sql`
      INSERT INTO questions (grade, category, type, subject, body, choices, answer)
      VALUES (${value.grade}, ${value.category}, ${value.type}, ${value.subject}, ${value.body}, ${choices}::jsonb, ${value.answer})
      RETURNING id, grade, category, type, subject, body, choices, answer`;
    return json({ question: row }, 201);
  }

  if (req.method === 'DELETE') {
    const id = Number(url.searchParams.get('id'));
    if (!Number.isInteger(id)) return json({ error: '문항 번호를 확인해 주세요.' }, 400);
    // 이미 출제된 기록(채점)에 영향이 없도록 삭제 대신 비활성화
    const rows = await sql`
      UPDATE questions SET is_active = FALSE WHERE id = ${id} AND is_active = TRUE RETURNING id`;
    return json({ ok: true, removed: rows.length });
  }

  return notAllowed();
});

export const config = { path: '/api/admin/questions' };
