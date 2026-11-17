export const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });

export async function readJson(req) {
  try {
    const text = await req.text();
    if (text.length > 20000) return null;
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export const notAllowed = () => json({ error: '허용되지 않는 요청이에요.' }, 405);
export const unauthorized = () => json({ error: '관리자 로그인이 필요해요.' }, 401);

export function handleErrors(fn) {
  return async (req, ctx) => {
    try {
      return await fn(req, ctx);
    } catch (e) {
      console.error(e);
      return json({ error: '서버에 문제가 생겼어요. 잠시 후 다시 시도해 주세요.' }, 500);
    }
  };
}
