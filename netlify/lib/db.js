let sqlInstance = null;

// Neon HTTP 드라이버 (서버리스에 적합). DATABASE_URL 은 Neon 연결 문자열.
export async function getSql() {
  if (sqlInstance) return sqlInstance;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL 환경변수가 필요합니다.');
  const { neon } = await import('@neondatabase/serverless');
  sqlInstance = neon(url);
  return sqlInstance;
}

// 테스트에서 가짜 DB를 주입하기 위한 용도
export function setSqlForTests(fn) {
  sqlInstance = fn;
}

// int[] 컬럼에 넣을 값 (정수만 허용하므로 리터럴로 안전하게 만든다)
export function intArrayLiteral(ids) {
  if (!ids.every((n) => Number.isInteger(n))) throw new Error('정수 배열이 아닙니다.');
  return `{${ids.join(',')}}`;
}

// 드라이버가 int[] 를 배열 또는 '{1,2}' 문자열로 돌려줘도 모두 처리
export function toIntArray(v) {
  if (Array.isArray(v)) return v.map(Number);
  if (typeof v === 'string') return v.replace(/[{}]/g, '').split(',').filter(Boolean).map(Number);
  return [];
}
