import { NONSENSE_COUNT } from './config.js';

// 일반(정규) 퀴즈 문제 풀: 학년별
export async function loadPool(sql, grade) {
  return sql`
    SELECT id, type, subject, body, choices
    FROM questions
    WHERE grade = ${grade} AND category = 'regular' AND is_active = TRUE`;
}

// 넌센스 퀴즈 문제 풀: 모든 학년 공통. (같은 문제가 여러 번 등록돼 있어도 한 번만 센다)
export async function countNonsense(sql) {
  const [row] = await sql`
    SELECT count(DISTINCT body)::int AS n
    FROM questions
    WHERE category = 'nonsense' AND is_active = TRUE`;
  return row?.n ?? 0;
}

// 넌센스 퀴즈: 공통 문제 중 무작위로 NONSENSE_COUNT(5)문제. 일반 퀴즈와 똑같이 정답은 내려보내지 않는다.
export async function loadNonsense(sql) {
  return sql`
    SELECT id, type, subject, body, choices
    FROM (
      SELECT DISTINCT ON (body) id, type, subject, body, choices
      FROM questions
      WHERE category = 'nonsense' AND is_active = TRUE
      ORDER BY body, id
    ) q
    ORDER BY random()
    LIMIT ${NONSENSE_COUNT}`;
}

// 학생에게 내려보내는 문제: 정답은 절대 포함하지 않는다 (일반/넌센스 공통)
export function toStudentQuestion(q) {
  return {
    id: q.id,
    type: q.type,
    subject: q.subject,
    body: q.body,
    choices: q.type === 'ox' ? ['O', 'X'] : q.choices,
  };
}
