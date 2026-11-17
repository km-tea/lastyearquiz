import { QUIZ_LAYOUT } from './config.js';

function shuffle(list, rng) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// 문제 풀에서 객관식 3 + OX 2를 뽑아, 가능한 한 서로 다른 교과가 되도록 섞는다.
// 출제 순서: 객관식, OX, 객관식, OX, 객관식. 문항이 부족하면 null.
export function pickQuestions(pool, rng = Math.random) {
  const ox = shuffle(pool.filter((q) => q.type === 'ox'), rng);
  const mc = shuffle(pool.filter((q) => q.type === 'mc'), rng);
  if (ox.length < QUIZ_LAYOUT.ox || mc.length < QUIZ_LAYOUT.mc) return null;

  const usedSubjects = new Set();
  const take = (list, n) => {
    const out = [];
    for (const q of list) {
      if (out.length < n && !usedSubjects.has(q.subject)) {
        out.push(q);
        usedSubjects.add(q.subject);
      }
    }
    for (const q of list) {
      if (out.length < n && !out.includes(q)) out.push(q);
    }
    return out;
  };

  const m = take(mc, QUIZ_LAYOUT.mc);
  const o = take(ox, QUIZ_LAYOUT.ox);
  return [m[0], o[0], m[1], o[1], m[2]];
}
