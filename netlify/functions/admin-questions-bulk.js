import { getSql } from '../lib/db.js';
import { json, readJson, notAllowed, unauthorized, handleErrors } from '../lib/http.js';
import { requireAdmin } from '../lib/auth.js';
import { parseBulkRows } from '../lib/bulk.js';

// 엑셀 일괄 등록. 화면에서 파일을 읽어 행(JSON)으로 보내면 서버가 다시 검증한다.
//  · dryRun: true  → 등록하지 않고 검사 결과만 돌려준다 (미리보기)
//  · 오류가 하나라도 있으면 아무것도 등록하지 않는다 (전부 등록되거나, 전부 안 됨)
export default handleErrors(async (req) => {
  if (req.method !== 'POST') return notAllowed();
  if (!requireAdmin(req)) return unauthorized();

  const body = await readJson(req);
  const { items, errors } = parseBulkRows(body?.rows);
  const summary = {
    count: items.length,
    regular: items.filter((q) => q.category === 'regular').length,
    nonsense: items.filter((q) => q.category === 'nonsense').length,
  };

  if (body?.dryRun === true) return json({ ...summary, errors });
  if (errors.length) {
    return json({ error: '오류가 있어서 등록하지 않았어요. 엑셀을 고쳐서 다시 올려 주세요.', errors }, 422);
  }
  if (!items.length) return json({ error: '등록할 문항이 없어요.' }, 400);

  const sql = await getSql();
  // 한 문장으로 한꺼번에 넣어서, 중간에 실패해도 일부만 등록되는 일이 없다.
  await sql`
    INSERT INTO questions (grade, category, type, subject, body, choices, answer)
    SELECT grade, category, type, subject, body, choices, answer
    FROM jsonb_to_recordset(${JSON.stringify(items)}::jsonb)
      AS t(grade int, category text, type text, subject text, body text, choices jsonb, answer int)`;
  return json({ ...summary, errors: [], inserted: items.length }, 201);
});

export const config = { path: '/api/admin/questions-bulk' };
