import { NONSENSE_COUNT } from './config.js';

// 정규 퀴즈 문제 풀 (수료 판정에 쓰이는 문제)
export async function loadPool(sql, grade) {
  return sql`
    SELECT id, type, subject, body, choices
    FROM questions
    WHERE grade = ${grade} AND category = 'regular' AND is_active = TRUE`;
}

export async function countNonsense(sql, grade) {
  const [row] = await sql`
    SELECT count(*)::int AS n
    FROM questions
    WHERE grade = ${grade} AND category = 'nonsense' AND is_active = TRUE`;
  return row?.n ?? 0;
}

export async function loadNonsense(sql, grade) {
  return sql`
    SELECT id, type, subject, body, choices, answer
    FROM questions
    WHERE grade = ${grade} AND category = 'nonsense' AND is_active = TRUE
    ORDER BY random()
    LIMIT ${NONSENSE_COUNT}`;
}

// 정규 문제: 정답은 절대 포함하지 않는다
export function toStudentQuestion(q) {
  return {
    id: q.id,
    type: q.type,
    subject: q.subject,
    body: q.body,
    choices: q.type === 'ox' ? ['O', 'X'] : q.choices,
  };
}

// 넌센스 문제: 수료와 무관한 재미용이라 즉시 정답을 보여 주기 위해 정답을 함께 내려보낸다
export function toNonsenseQuestion(q) {
  return { ...toStudentQuestion(q), answer: q.answer };
}
