import { validateQuestion } from './config.js';

export const MAX_BULK_ROWS = 500;

// 엑셀 양식 한 행 → 문항. 헤더: 학년 · 구분 · 유형 · 교과 · 문제 · 보기1~4 · 정답
const cell = (v) => (v === null || v === undefined ? '' : String(v).trim());
const normKey = (k) => String(k).replace(/\s+/g, '');

const CIRCLED = { '①': 1, '②': 2, '③': 3, '④': 4 };

function parseCategory(s) {
  const t = s.replace(/\s+/g, '');
  if (t === '' || t === '정규' || t === '정규문제') return 'regular';
  if (t === '넌센스' || t === '넌센스문제') return 'nonsense';
  return null;
}

function parseType(s) {
  const t = s.toUpperCase().replace(/[^A-Z가-힣0-9]/g, '');
  if (t.startsWith('OX')) return 'ox';
  if (t.startsWith('객관식') || t === 'MC') return 'mc';
  return null;
}

function parseAnswer(type, s) {
  const t = s.toUpperCase().replace(/\s+/g, '');
  if (type === 'ox') {
    if (t === 'O' || t === '○' || t === '◯') return 0;
    if (t === 'X' || t === '×' || t === '✕') return 1;
    return NaN;
  }
  if (t in CIRCLED) return CIRCLED[t] - 1;
  if (/^[1-4]$/.test(t) || /^[1-4]\.0$/.test(t)) return Number(t[0]) - 1;
  return NaN;
}

// rows: SheetJS sheet_to_json 결과(헤더 이름 → 값). 오류는 엑셀 행 번호(헤더가 1행이므로 +2)로 알려 준다.
export function parseBulkRows(rows) {
  const items = [];
  const errors = [];
  if (!Array.isArray(rows)) return { items, errors: [{ row: 0, message: '업로드한 데이터를 읽을 수 없어요.' }] };
  if (rows.length > MAX_BULK_ROWS) {
    return { items, errors: [{ row: 0, message: `한 번에 최대 ${MAX_BULK_ROWS}행까지 올릴 수 있어요.` }] };
  }

  rows.forEach((raw, i) => {
    if (!raw || typeof raw !== 'object') return;
    const row = i + 2;
    const r = {};
    for (const [k, v] of Object.entries(raw)) r[normKey(k)] = cell(v);
    if (Object.values(r).every((v) => v === '')) return; // 빈 줄은 건너뜀

    const fail = (message) => errors.push({ row, message });

    const grade = r['학년'].replace(/학년$/, '');
    const category = parseCategory(r['구분'] ?? '');
    if (!category) return fail('구분은 "정규" 또는 "넌센스"로 입력해 주세요.');
    const type = parseType(r['유형'] ?? '');
    if (!type) return fail('유형은 "객관식" 또는 "OX"로 입력해 주세요.');

    const result = validateQuestion({
      grade: /^\d+$/.test(grade) ? Number(grade) : NaN,
      category,
      type,
      subject: r['교과'],
      body: r['문제'],
      choices: type === 'mc' ? [r['보기1'], r['보기2'], r['보기3'], r['보기4']] : undefined,
      answer: parseAnswer(type, r['정답'] ?? ''),
    });
    if (result.error) return fail(result.error);
    items.push(result.value);
  });

  return { items, errors };
}
