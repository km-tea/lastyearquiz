import test from 'node:test';
import assert from 'node:assert/strict';

process.env.TOKEN_SECRET = 'test-secret-test-secret';
process.env.LOGIN_FAIL_DELAY_MS = '0';
delete process.env.ADMIN_CODE; // 기본 코드 0227 확인

const { setSqlForTests } = await import('../netlify/lib/db.js');

// ---- 아주 작은 메모리 DB (핸들러가 쓰는 쿼리만 흉내) ----
const db = { questions: [], attempts: [], failures: [], qSeq: 1, aSeq: 1 };

function fakeSql(strings, ...v) {
  const q = strings.join('?').replace(/\s+/g, ' ').trim();
  const parseArr = (s) => s.replace(/[{}]/g, '').split(',').filter(Boolean).map(Number);
  const same = (a, g, c, n) => a.grade === g && a.class_no === c && a.number === n;
  const ok = (rows) => Promise.resolve(rows);

  if (q.startsWith('SELECT status FROM attempts')) {
    return ok(db.attempts.filter((a) => same(a, v[0], v[1], v[2])).map((a) => ({ status: a.status })));
  }
  if (q.startsWith("SELECT id, type, subject, body, choices FROM questions WHERE grade = ? AND category = 'regular'")) {
    return ok(db.questions.filter((x) => x.grade === v[0] && x.category === 'regular' && x.is_active));
  }
  if (q.startsWith('SELECT count(*)::int AS n FROM questions')) {
    return ok([{ n: db.questions.filter((x) => x.grade === v[0] && x.category === 'nonsense' && x.is_active).length }]);
  }
  if (q.startsWith("SELECT id, type, subject, body, choices FROM questions WHERE grade = ? AND category = 'nonsense'")) {
    return ok(db.questions.filter((x) => x.grade === v[0] && x.category === 'nonsense' && x.is_active).slice(0, v[1]));
  }
  if (q.startsWith('INSERT INTO attempts')) {
    const ids = parseArr(v[3]);
    const found = db.attempts.find((a) => same(a, v[0], v[1], v[2]));
    if (!found) {
      const row = { id: db.aSeq++, grade: v[0], class_no: v[1], number: v[2], status: 'started', question_ids: ids, score: null, attempt_count: 1, submitted_at: null };
      db.attempts.push(row);
      return ok([{ id: row.id, attempt_count: 1 }]);
    }
    if (found.status === 'completed') return ok([]); // WHERE attempts.status <> 'completed'
    Object.assign(found, { status: 'started', question_ids: ids, score: null, submitted_at: null, attempt_count: found.attempt_count + 1 });
    return ok([{ id: found.id, attempt_count: found.attempt_count }]);
  }
  if (q.startsWith('SELECT id, status, question_ids, attempt_count FROM attempts')) {
    return ok(db.attempts.filter((a) => a.id === v[0]));
  }
  if (q.startsWith('SELECT id, answer FROM questions WHERE id = ANY')) {
    const ids = parseArr(v[0]);
    return ok(db.questions.filter((x) => ids.includes(x.id)).map((x) => ({ id: x.id, answer: x.answer })));
  }
  if (q.startsWith('UPDATE attempts')) {
    const a = db.attempts.find((x) => x.id === v[2] && x.status === 'started' && x.attempt_count === v[3]);
    if (!a) return ok([]);
    Object.assign(a, { status: v[0], score: v[1], submitted_at: new Date().toISOString() });
    return ok([{ id: a.id }]);
  }
  if (q.startsWith('SELECT grade, class_no, number, status, score, attempt_count, submitted_at FROM attempts')) {
    return ok(db.attempts);
  }
  if (q.startsWith('DELETE FROM attempts')) {
    const hit = db.attempts.filter((a) => same(a, v[0], v[1], v[2]));
    db.attempts = db.attempts.filter((a) => !hit.includes(a));
    return ok(hit.map((a) => ({ id: a.id })));
  }
  if (q.startsWith('INSERT INTO questions (grade, category, type, subject, body, choices, answer) VALUES')) {
    const row = { id: db.qSeq++, grade: v[0], category: v[1], type: v[2], subject: v[3], body: v[4], choices: v[5] ? JSON.parse(v[5]) : null, answer: v[6], is_active: true };
    db.questions.push(row);
    return ok([row]);
  }
  if (q.startsWith('INSERT INTO questions (grade, category, type, subject, body, choices, answer) SELECT')) {
    for (const it of JSON.parse(v[0])) db.questions.push({ id: db.qSeq++, ...it, is_active: true });
    return ok([]);
  }
  if (q.startsWith('SELECT id, grade, category, type, subject, body, choices, answer FROM questions WHERE grade =')) {
    return ok(db.questions.filter((x) => x.grade === v[0] && x.is_active));
  }
  if (q.startsWith('UPDATE questions SET is_active = FALSE')) {
    const x = db.questions.find((r) => r.id === v[0] && r.is_active);
    if (x) x.is_active = false;
    return ok(x ? [{ id: x.id }] : []);
  }
  if (q.startsWith('SELECT count(*)::int AS n FROM admin_login_failures')) return ok([{ n: db.failures.length }]);
  if (q.startsWith('INSERT INTO admin_login_failures')) { db.failures.push(1); return ok([]); }
  if (q.startsWith('DELETE FROM admin_login_failures')) return ok([]);
  throw new Error(`fake sql: 처리되지 않은 쿼리: ${q}`);
}
setSqlForTests(fakeSql);

const h = async (file) => (await import(`../netlify/functions/${file}.js`)).default;
const call = (fn, method, url, body, token) =>
  fn(new Request(`http://x${url}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  }));

async function adminToken() {
  const login = await h('admin-login');
  const res = await call(login, 'POST', '/', { code: '0227' });
  assert.equal(res.status, 200);
  return (await res.json()).token;
}

const correctAnswersFor = (questions) => questions.map((q) => db.questions.find((x) => x.id === q.id).answer);

test('관리자 코드 로그인 (0227만 입력)', async () => {
  const login = await h('admin-login');
  assert.equal((await call(login, 'POST', '/', { code: '1111' })).status, 401);
  assert.equal((await call(login, 'POST', '/', {})).status, 401);
  assert.equal((await call(login, 'POST', '/', { id: 'admin', password: 'x' })).status, 401); // 예전 방식은 불가
  const ok = await call(login, 'POST', '/', { code: '0227' });
  assert.equal(ok.status, 200);
  assert.ok((await ok.json()).token);
});

test('권한 없으면 관리자 API 거부', async () => {
  for (const f of ['admin-questions', 'admin-attempts', 'admin-reset', 'admin-questions-bulk']) {
    const fn = await h(f);
    const isGet = f === 'admin-questions' || f === 'admin-attempts';
    const res = await call(fn, isGet ? 'GET' : 'POST', '/?grade=2', isGet ? undefined : {});
    assert.equal(res.status, 401, f);
  }
});

test('문항 등록 → 일반/넌센스 선택 → 오답 시 재도전 → 어느 쪽이든 전부 정답이면 수료 → 승인 후 재참여', async () => {
  const admin = await adminToken();
  const questions = await h('admin-questions');
  const check = await h('student-check');
  const start = await h('student-start');
  const submit = await h('student-submit');
  const attempts = await h('admin-attempts');
  const reset = await h('admin-reset');

  const seat = { grade: 2, classNo: 3, number: 15 };
  assert.equal((await call(check, 'POST', '/', seat)).status, 503); // 문항 없음
  assert.equal((await call(start, 'POST', '/', { ...seat, track: 'nonsense' })).status, 503);

  const subjects = ['국어', '수학', '사회', '과학', '영어'];
  for (let i = 0; i < 2; i++) {
    assert.equal((await call(questions, 'POST', '/', { grade: 2, type: 'ox', subject: subjects[i], body: `ox${i}`, answer: i }, admin)).status, 201);
  }
  for (let i = 0; i < 3; i++) {
    assert.equal((await call(questions, 'POST', '/', { grade: 2, type: 'mc', subject: subjects[i + 2], body: `mc${i}`, choices: ['a', 'b', 'c', 'd'], answer: i }, admin)).status, 201);
  }
  assert.equal((await call(questions, 'POST', '/', { grade: 2, type: 'mc', subject: '국어', body: 'bad', choices: ['a'], answer: 0 }, admin)).status, 400);

  // 허용되지 않은 번호
  assert.equal((await call(check, 'POST', '/', { grade: 3, classNo: 5, number: 1 })).status, 400);
  assert.equal((await call(check, 'POST', '/', { grade: 2, classNo: 1, number: 31 })).status, 400);

  // 넌센스 문항이 없으면 일반만 선택 가능
  const c1 = await (await call(check, 'POST', '/', seat)).json();
  assert.deepEqual([c1.ok, c1.regularAvailable, c1.nonsenseAvailable], [true, true, false]);
  assert.equal((await call(start, 'POST', '/', { ...seat, track: 'nonsense' })).status, 503); // 준비 안 된 쪽은 시작 불가

  // 넌센스 문항 추가 (교과는 자동으로 '넌센스'). 5개가 되어야 선택 가능
  const n1 = await (await call(questions, 'POST', '/', { grade: 2, category: 'nonsense', type: 'mc', body: '세상에서 가장 뜨거운 바다는?', choices: ['열바다', '동해', '서해', '남해'], answer: 0 }, admin)).json();
  assert.equal(n1.question.subject, '넌센스');
  for (let i = 0; i < 3; i++) {
    assert.equal((await call(questions, 'POST', '/', { grade: 2, category: 'nonsense', type: 'mc', body: `넌센스 mc${i}`, choices: ['가', '나', '다', '라'], answer: i }, admin)).status, 201);
  }
  assert.equal((await (await call(check, 'POST', '/', seat)).json()).nonsenseAvailable, false); // 4개: 아직 부족
  assert.equal((await call(questions, 'POST', '/', { grade: 2, category: 'nonsense', type: 'ox', body: '넌센스 OX', answer: 1 }, admin)).status, 201);
  const c2 = await (await call(check, 'POST', '/', seat)).json();
  assert.deepEqual([c2.regularAvailable, c2.nonsenseAvailable], [true, true]);

  // 1차 도전: 일반 퀴즈 (track 생략 = 일반)
  const s1 = await (await call(start, 'POST', '/', seat)).json();
  assert.equal(s1.track, 'regular');
  assert.equal(s1.questions.length, 5);
  assert.deepEqual(s1.questions.map((q) => q.type), ['mc', 'ox', 'mc', 'ox', 'mc']);
  assert.ok(s1.questions.every((q) => !('answer' in q) && db.questions.find((x) => x.id === q.id).category === 'regular'));

  // 오답 → 미수료
  const wrong = correctAnswersFor(s1.questions);
  wrong[0] = (wrong[0] + 1) % 4;
  const f1 = await (await call(submit, 'POST', '/', { token: s1.token, answers: wrong })).json();
  assert.deepEqual([f1.score, f1.completed], [4, false]);
  assert.equal((await call(submit, 'POST', '/', { token: s1.token, answers: wrong })).status, 409); // 재제출 불가
  assert.equal((await call(submit, 'POST', '/', { token: 'forged.token', answers: wrong })).status, 401);

  // 2차 도전: 넌센스 퀴즈 선택 → 5문제, 정답은 내려오지 않음, 오답이면 미수료
  assert.equal((await call(check, 'POST', '/', seat)).status, 200);
  const s2 = await (await call(start, 'POST', '/', { ...seat, track: 'nonsense' })).json();
  assert.equal(s2.track, 'nonsense');
  assert.equal(s2.questions.length, 5);
  assert.equal(new Set(s2.questions.map((q) => q.id)).size, 5);
  assert.ok(s2.questions.every((q) => !('answer' in q) && db.questions.find((x) => x.id === q.id).category === 'nonsense'));
  assert.ok(s2.questions.every((q) => q.subject === '넌센스'));
  const wrongN = correctAnswersFor(s2.questions);
  wrongN[2] = (wrongN[2] + 1) % (s2.questions[2].type === 'ox' ? 2 : 4);
  const f2 = await (await call(submit, 'POST', '/', { token: s2.token, answers: wrongN })).json();
  assert.deepEqual([f2.score, f2.completed], [4, false]);

  // 3차 도전을 시작하면 이전 토큰은 무효 (알 수 없는 track 값은 일반으로 처리)
  const s3 = await (await call(start, 'POST', '/', { ...seat, track: 'nonsense' })).json();
  const s4 = await (await call(start, 'POST', '/', { ...seat, track: 'whatever' })).json();
  assert.equal(s4.track, 'regular');
  const stale = await call(submit, 'POST', '/', { token: s3.token, answers: correctAnswersFor(s3.questions) });
  assert.equal(stale.status, 409);

  let list = (await (await call(attempts, 'GET', '/', undefined, admin)).json()).attempts;
  assert.deepEqual([list[0].status, list[0].attempt_count], ['started', 4]);

  // 일반 퀴즈를 모두 맞히면 수료
  const done = await (await call(submit, 'POST', '/', { token: s4.token, answers: correctAnswersFor(s4.questions) })).json();
  assert.deepEqual([done.score, done.completed], [5, true]);

  // 수료자는 (넌센스를 고르더라도) 차단
  assert.equal((await call(check, 'POST', '/', seat)).status, 409);
  assert.equal((await call(start, 'POST', '/', seat)).status, 409);
  assert.equal((await call(start, 'POST', '/', { ...seat, track: 'nonsense' })).status, 409);
  list = (await (await call(attempts, 'GET', '/', undefined, admin)).json()).attempts;
  assert.equal(list[0].status, 'completed');

  // 관리자 승인(기록 삭제) 후 다시 참여 가능
  assert.equal((await (await call(reset, 'POST', '/', seat, admin)).json()).removed, 1);
  assert.equal((await call(check, 'POST', '/', seat)).status, 200);

  // 승인 후에는 넌센스 퀴즈를 모두 맞혀도 수료 (넌센스도 수료로 인정)
  const s5 = await (await call(start, 'POST', '/', { ...seat, track: 'nonsense' })).json();
  const done2 = await (await call(submit, 'POST', '/', { token: s5.token, answers: correctAnswersFor(s5.questions) })).json();
  assert.deepEqual([done2.score, done2.completed], [5, true]);
  list = (await (await call(attempts, 'GET', '/', undefined, admin)).json()).attempts;
  assert.equal(list[0].status, 'completed');
  assert.equal((await call(check, 'POST', '/', seat)).status, 409);

  // 문항 삭제(비활성화)
  assert.equal((await (await call(questions, 'DELETE', '/?id=1', undefined, admin)).json()).removed, 1);
});

test('엑셀 일괄 등록: 미리보기 → 오류 시 전체 거부 → 정상 등록', async () => {
  const admin = await adminToken();
  const bulk = await h('admin-questions-bulk');
  const before = db.questions.length;

  const good = [
    { 학년: 5, 구분: '정규', 유형: '객관식', 교과: '수학', 문제: '12의 약수가 아닌 것은?', 보기1: 3, 보기2: 4, 보기3: 5, 보기4: 6, 정답: 3 },
    { 학년: '5학년', 구분: '', 유형: 'OX', 교과: '사회', 문제: '독도는 우리나라 영토이다.', 보기1: '', 보기2: '', 보기3: '', 보기4: '', 정답: 'O' },
    { 학년: 5, 구분: '넌센스', 유형: 'O X 퀴즈', 교과: '', 문제: '넌센스 OX', 정답: 'X' },
    { 학년: '', 구분: '', 유형: '', 교과: '', 문제: '', 정답: '' }, // 빈 줄은 무시
  ];
  const bad = [...good, { 학년: 7, 구분: '정규', 유형: '객관식', 교과: '수학', 문제: 'x', 보기1: 'a', 보기2: 'b', 보기3: 'c', 보기4: 'd', 정답: 1 }];

  const dry = await (await call(bulk, 'POST', '/', { rows: good, dryRun: true }, admin)).json();
  assert.deepEqual([dry.count, dry.regular, dry.nonsense, dry.errors.length], [3, 2, 1, 0]);
  assert.equal(db.questions.length, before); // 미리보기는 저장하지 않음

  const badDry = await (await call(bulk, 'POST', '/', { rows: bad, dryRun: true }, admin)).json();
  assert.equal(badDry.errors.length, 1);
  assert.equal(badDry.errors[0].row, 6); // 엑셀 6행 (헤더 1행 + 5번째 데이터)

  const rejected = await call(bulk, 'POST', '/', { rows: bad }, admin);
  assert.equal(rejected.status, 422);
  assert.equal(db.questions.length, before); // 하나라도 오류면 전부 미등록

  const saved = await call(bulk, 'POST', '/', { rows: good }, admin);
  assert.equal(saved.status, 201);
  assert.equal(db.questions.length, before + 3);
  const added = db.questions.slice(-3);
  assert.deepEqual(added.map((q) => [q.grade, q.category, q.type, q.answer]), [[5, 'regular', 'mc', 2], [5, 'regular', 'ox', 0], [5, 'nonsense', 'ox', 1]]);
  assert.equal(added[2].subject, '넌센스');
});

test('관리자 코드 무작위 대입 방지 (최근 실패 10번 넘으면 잠금)', async () => {
  db.failures = [];
  const login = await h('admin-login');
  for (let i = 0; i < 10; i++) assert.equal((await call(login, 'POST', '/', { code: String(1000 + i) })).status, 401);
  assert.equal((await call(login, 'POST', '/', { code: '0227' })).status, 429); // 맞는 코드도 잠시 불가
  db.failures = [];
  assert.equal((await call(login, 'POST', '/', { code: '0227' })).status, 200);
});
