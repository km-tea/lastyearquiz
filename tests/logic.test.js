import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSeat, validateQuestion } from '../netlify/lib/config.js';
import { pickQuestions } from '../netlify/lib/pick.js';
import { parseBulkRows } from '../netlify/lib/bulk.js';

process.env.TOKEN_SECRET = 'test-secret-test-secret';
const { signToken, verifyToken } = await import('../netlify/lib/auth.js');

test('학급/번호 범위 검증', () => {
  assert.ok(parseSeat({ grade: 1, classNo: 5, number: 30 }));
  assert.ok(parseSeat({ grade: 3, classNo: 4, number: 1 }));
  assert.equal(parseSeat({ grade: 3, classNo: 5, number: 1 }), null); // 3학년은 4개 반
  assert.equal(parseSeat({ grade: 5, classNo: 5, number: 1 }), null);
  assert.equal(parseSeat({ grade: 6, classNo: 5, number: 1 }), null);
  assert.equal(parseSeat({ grade: 2, classNo: 5, number: 31 }), null); // 31번 불가
  assert.equal(parseSeat({ grade: 2, classNo: 1, number: 0 }), null);
  assert.equal(parseSeat({ grade: 7, classNo: 1, number: 1 }), null);
  assert.equal(parseSeat({ grade: true, classNo: 1, number: 1 }), null);
  assert.equal(parseSeat(null), null);
});

test('문항 검증', () => {
  const ok = validateQuestion({ grade: 1, type: 'ox', subject: '수학', body: '1+1=2', answer: 0 });
  assert.equal(ok.value.choices, null);
  assert.ok(validateQuestion({ grade: 1, type: 'ox', subject: '수학', body: 'x', answer: 2 }).error);
  assert.ok(validateQuestion({ grade: 1, type: 'mc', subject: '수학', body: 'x', choices: ['a', 'b', 'c'], answer: 0 }).error);
  assert.ok(validateQuestion({ grade: 1, type: 'mc', subject: '수학', body: 'x', choices: ['a', 'a', 'c', 'd'], answer: 0 }).error);
  assert.ok(validateQuestion({ grade: 1, type: 'mc', subject: '수학', body: 'x', choices: ['a', 'b', 'c', 'd'], answer: 3 }).value);
  assert.ok(validateQuestion({ grade: 1, type: 'mc', subject: '없는교과', body: 'x', choices: ['a', 'b', 'c', 'd'], answer: 0 }).error);
});

test('넌센스 문항은 교과 없이 등록되고, 구분 값이 잘못되면 거부', () => {
  const r = validateQuestion({ grade: 3, category: 'nonsense', type: 'ox', body: '넌센스', answer: 0 });
  assert.equal(r.value.subject, '넌센스');
  assert.equal(r.value.category, 'nonsense');
  assert.ok(validateQuestion({ grade: 3, category: 'etc', type: 'ox', subject: '수학', body: 'x', answer: 0 }).error);
  assert.equal(validateQuestion({ grade: 3, type: 'ox', subject: '수학', body: 'x', answer: 0 }).value.category, 'regular');
});

test('엑셀 행 변환: 여러 표기와 오류 행 번호', () => {
  const rows = [
    { '학년': 1, '구분': '정규', '유형': '객관식', '교과': '수학', '문제': '2+3?', '보기1': 4, '보기2': 5, '보기3': 6, '보기4': 7, '정답': 2 },
    { '학년': '6학년', '구분': '넌센스', '유형': 'OX', '교과': '', '문제': 'q', '정답': '×' },
    { '학년': 2, '구분': '정규', '유형': '객관식', '교과': '국어', '문제': 'q', '보기1': 'a', '보기2': 'b', '보기3': 'c', '보기4': 'd', '정답': '③' },
    { ' 학년 ': 3, '구분': '정규', '유형': 'OX 퀴즈', '교과': '과학', '문제': 'q', '정답': 'o' },
  ];
  const ok = parseBulkRows(rows);
  assert.equal(ok.errors.length, 0);
  assert.deepEqual(ok.items.map((q) => q.answer), [1, 1, 2, 0]);
  assert.deepEqual(ok.items.map((q) => q.grade), [1, 6, 2, 3]);

  const bad = parseBulkRows([
    { 학년: 1, 구분: '정규', 유형: '객관식', 교과: '수학', 문제: 'q', 보기1: 'a', 보기2: 'a', 보기3: 'c', 보기4: 'd', 정답: 1 }, // 2행: 보기 중복
    { 학년: 1, 구분: '기타', 유형: 'OX', 교과: '수학', 문제: 'q', 정답: 'O' },                                              // 3행: 구분 오류
    { 학년: 1, 구분: '정규', 유형: '서술형', 교과: '수학', 문제: 'q', 정답: 'O' },                                           // 4행: 유형 오류
    { 학년: 1, 구분: '정규', 유형: 'OX', 교과: '수학', 문제: 'q', 정답: '5' },                                               // 5행: OX 정답 오류
    { 학년: 1, 구분: '정규', 유형: '객관식', 교과: '수학', 문제: 'q', 보기1: 'a', 보기2: 'b', 보기3: 'c', 보기4: 'd', 정답: 5 }, // 6행: 정답 번호 오류
    { 학년: 1, 구분: '정규', 유형: 'OX', 교과: '없는교과', 문제: 'q', 정답: 'O' },                                           // 7행: 교과 오류
  ]);
  assert.deepEqual(bad.errors.map((e) => e.row), [2, 3, 4, 5, 6, 7]);
  assert.equal(bad.items.length, 0);
  assert.ok(parseBulkRows('x').errors.length);
});

test('출제: OX 2 + 객관식 3, 교과 최대한 다양', () => {
  const subjects = ['국어', '수학', '사회', '과학', '영어'];
  const pool = [];
  let id = 1;
  for (const s of subjects) {
    pool.push({ id: id++, type: 'ox', subject: s }, { id: id++, type: 'mc', subject: s });
    pool.push({ id: id++, type: 'mc', subject: s });
  }
  for (let i = 0; i < 50; i++) {
    const picked = pickQuestions(pool);
    assert.equal(picked.length, 5);
    assert.equal(picked.filter((q) => q.type === 'ox').length, 2);
    assert.equal(picked.filter((q) => q.type === 'mc').length, 3);
    assert.equal(new Set(picked.map((q) => q.id)).size, 5);
    assert.equal(new Set(picked.map((q) => q.subject)).size, 5); // 5개 교과가 있으면 모두 다르게
  }
});

test('문항 부족하면 출제 불가', () => {
  const pool = [
    { id: 1, type: 'ox', subject: 'a' }, { id: 2, type: 'mc', subject: 'a' },
    { id: 3, type: 'mc', subject: 'b' }, { id: 4, type: 'mc', subject: 'c' },
  ];
  assert.equal(pickQuestions(pool), null);
});

test('토큰 서명/만료/변조', () => {
  const t = signToken({ aid: 7 }, 60);
  assert.equal(verifyToken(t).aid, 7);
  assert.equal(verifyToken(t + 'x'), null);
  assert.equal(verifyToken(signToken({ aid: 7 }, -10)), null);
  const [body, sig] = t.split('.');
  const forged = Buffer.from(JSON.stringify({ aid: 8, exp: 9999999999 })).toString('base64url');
  assert.equal(verifyToken(`${forged}.${sig}`), null);
  assert.equal(verifyToken(null), null);
  assert.ok(body);
});
