(() => {
  'use strict';

  const $ = (sel) => document.querySelector(sel);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const FAIL_RETURN_SECONDS = 5;

  const state = {
    config: null,
    grade: null,
    classNo: null,
    number: null,
    token: null,
    mode: 'quiz',          // 'nonsense' | 'quiz'
    questions: [],         // 정규 퀴즈 5문제
    answers: [],
    index: 0,
    nonsense: [],          // 넌센스 문제(선택 시)
    nIndex: 0,
    nRevealed: false,
    inProgress: false,
  };
  let failTimer = null;

  function show(name) {
    document.querySelectorAll('.screen').forEach((el) => {
      el.hidden = el.dataset.screen !== name;
    });
    window.scrollTo(0, 0);
  }

  async function post(path, body) {
    const res = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    let data = {};
    try { data = await res.json(); } catch { /* ignore */ }
    if (!res.ok) {
      const err = new Error(data.error || '문제가 생겼어요. 잠시 후 다시 시도해 주세요.');
      err.status = res.status;
      err.code = data.code;
      throw err;
    }
    return data;
  }

  function button(text, className, onClick) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = className;
    b.textContent = text;
    b.addEventListener('click', onClick);
    return b;
  }

  const seatText = () => `${state.grade}학년 ${state.classNo}반 ${state.number}번`;

  // ---------- 1) 학년 선택 ----------
  function renderGrades() {
    $('#grade-list').replaceChildren(
      ...state.config.grades.map((g) =>
        button(`${g.grade}학년`, 'pick grade-btn', () => {
          state.grade = g.grade;
          state.classNo = null;
          state.number = null;
          renderSeat();
        }),
      ),
    );
    show('grade');
  }

  // ---------- 2) 반 / 번호 선택 ----------
  function renderSeat() {
    const info = state.config.grades.find((g) => g.grade === state.grade);
    $('#seat-title').textContent = `${state.grade}학년`;

    $('#class-list').replaceChildren(
      ...Array.from({ length: info.classes }, (_, i) => i + 1).map((c) =>
        button(`${c}반`, 'pick', () => { state.classNo = c; refreshSeat(); }),
      ),
    );
    $('#number-list').replaceChildren(
      ...Array.from({ length: state.config.maxNumber }, (_, i) => i + 1).map((n) =>
        button(String(n), 'pick', () => { state.number = n; refreshSeat(); }),
      ),
    );
    refreshSeat();
    show('seat');
  }

  function refreshSeat() {
    [...$('#class-list').children].forEach((b, i) =>
      b.classList.toggle('selected', state.classNo === i + 1));
    [...$('#number-list').children].forEach((b, i) =>
      b.classList.toggle('selected', state.number === i + 1));
    const ready = state.classNo && state.number;
    $('#seat-summary').textContent = ready ? seatText() : '';
    $('#seat-confirm').disabled = !ready;
  }

  // ---------- 3) 확인 → 넌센스 선택 → 5초 안내 → 시작 ----------
  function askNonsense(available) {
    return new Promise((resolve) => {
      $('#nonsense-note').hidden = available;
      $('#nonsense-yes').hidden = !available;
      $('#nonsense-no').textContent = available ? '아니요, 바로 퀴즈 풀래요' : '퀴즈 시작하기';
      $('#nonsense-yes').onclick = () => resolve(true);
      $('#nonsense-no').onclick = () => resolve(false);
      show('nonsense-ask');
    });
  }

  async function startFlow() {
    const seat = { grade: state.grade, classNo: state.classNo, number: state.number };
    $('#seat-confirm').disabled = true;
    try {
      const check = await post('/api/student/check', seat);
      const wantNonsense = await askNonsense(check.nonsenseAvailable === true);

      show('countdown');
      for (let n = 5; n >= 1; n--) {
        $('#count-num').textContent = String(n);
        await sleep(1000);
      }

      const data = await post('/api/student/start', { ...seat, wantNonsense });
      state.token = data.token;
      state.questions = data.questions;
      state.answers = new Array(data.questions.length).fill(null);
      state.index = 0;
      state.nonsense = data.nonsense || [];
      state.nIndex = 0;
      state.inProgress = true;
      if (state.nonsense.length) renderNonsense(); else renderQuestion();
    } catch (e) {
      showBlocked(e);
    } finally {
      $('#seat-confirm').disabled = !(state.classNo && state.number);
    }
  }

  function showBlocked(e) {
    const already = e.code === 'ALREADY';
    $('#blocked-emoji').textContent = already ? '🎓' : '⚠️';
    $('#blocked-title').textContent = already ? '이미 수료했어요' : '앗, 잠깐만요';
    $('#blocked-msg').textContent = e.message;
    state.inProgress = false;
    show('blocked');
  }

  // ---------- 문제 화면 공통 ----------
  const typeLabel = (q) => (q.type === 'ox' ? 'O X 퀴즈' : '객관식');
  const optionLabel = (q, text, i) => (q.type === 'ox' ? text : `${i + 1}. ${text}`);

  function drawHeader(q, index, total, tag) {
    $('#progress').replaceChildren(
      ...Array.from({ length: total }, (_, i) => {
        const s = document.createElement('span');
        if (i <= index) s.className = 'done';
        return s;
      }),
    );
    $('#q-subject').textContent = q.subject;
    $('#q-type').textContent = `${tag}${index + 1} / ${total} · ${typeLabel(q)}`;
    $('#q-body').textContent = q.body;
    $('#quiz-error').hidden = true;
    $('#q-feedback').hidden = true;
    const box = $('#q-options');
    box.className = `options ${q.type}`;
    return box;
  }

  // ---------- 넌센스 라운드 (수료와 무관, 바로 정답 확인) ----------
  function renderNonsense() {
    state.mode = 'nonsense';
    state.nRevealed = false;
    const q = state.nonsense[state.nIndex];
    const box = drawHeader(q, state.nIndex, state.nonsense.length, '넌센스 ');
    box.replaceChildren(
      ...q.choices.map((text, i) => button(optionLabel(q, text, i), 'option', () => revealNonsense(q, i, box))),
    );
    $('#q-next').textContent = state.nIndex === state.nonsense.length - 1 ? '퀴즈 시작하기' : '다음 넌센스';
    $('#q-next').disabled = true;
    show('quiz');
  }

  function revealNonsense(q, picked, box) {
    if (state.nRevealed) return;
    state.nRevealed = true;
    [...box.children].forEach((b, j) => {
      b.disabled = true;
      if (j === q.answer) b.classList.add('correct');
      else if (j === picked) b.classList.add('wrong');
    });
    const fb = $('#q-feedback');
    fb.textContent = picked === q.answer
      ? '딩동댕! 정답이에요 🎉'
      : `아쉬워요! 정답은 "${q.choices[q.answer]}"이에요.`;
    fb.className = `feedback ${picked === q.answer ? 'good' : 'bad'}`;
    fb.hidden = false;
    $('#q-next').disabled = false;
  }

  // ---------- 정규 퀴즈 ----------
  function renderQuestion() {
    state.mode = 'quiz';
    const q = state.questions[state.index];
    const total = state.questions.length;
    const box = drawHeader(q, state.index, total, '');
    box.replaceChildren(
      ...q.choices.map((text, i) => {
        const b = button(optionLabel(q, text, i), 'option', () => {
          state.answers[state.index] = i;
          [...box.children].forEach((c, j) => c.classList.toggle('selected', j === i));
          $('#q-next').disabled = false;
        });
        if (state.answers[state.index] === i) b.classList.add('selected');
        return b;
      }),
    );
    $('#q-next').textContent = state.index === total - 1 ? '제출하기' : '다음 문제';
    $('#q-next').disabled = state.answers[state.index] === null;
    show('quiz');
  }

  async function nextOrSubmit() {
    if (state.mode === 'nonsense') {
      if (state.nIndex < state.nonsense.length - 1) {
        state.nIndex += 1;
        renderNonsense();
      } else {
        renderQuestion();
      }
      return;
    }

    if (state.index < state.questions.length - 1) {
      state.index += 1;
      renderQuestion();
      return;
    }
    $('#q-next').disabled = true;
    try {
      const result = await post('/api/student/submit', { token: state.token, answers: state.answers });
      state.inProgress = false;
      if (result.completed) {
        $('#done-seat').textContent = seatText();
        show('done');
      } else {
        showFail(result);
      }
    } catch (e) {
      const el = $('#quiz-error');
      el.textContent = e.message;
      el.hidden = false;
      $('#q-next').disabled = false;
    }
  }

  // ---------- 틀렸을 때: 안내 후 첫 화면으로 ----------
  function showFail(result) {
    $('#fail-score').textContent = `${result.total}문제 중 ${result.score}문제를 맞혔어요.`;
    let left = FAIL_RETURN_SECONDS;
    const label = () => { $('#fail-timer').textContent = `${left}초 뒤에 처음 화면으로 돌아가요.`; };
    label();
    show('fail');
    clearInterval(failTimer);
    failTimer = setInterval(() => {
      left -= 1;
      if (left <= 0) reset(); else label();
    }, 1000);
  }

  // ---------- 처음으로 ----------
  function reset() {
    clearInterval(failTimer);
    state.grade = state.classNo = state.number = state.token = null;
    state.inProgress = false;
    renderGrades();
  }

  window.addEventListener('beforeunload', (e) => {
    if (state.inProgress) { e.preventDefault(); e.returnValue = ''; }
  });

  $('#seat-confirm').addEventListener('click', startFlow);
  $('#seat-back').addEventListener('click', reset);
  $('#blocked-home').addEventListener('click', reset);
  $('#fail-home').addEventListener('click', reset);
  $('#q-next').addEventListener('click', nextOrSubmit);

  (async () => {
    try {
      const res = await fetch('/api/config');
      state.config = await res.json();
      renderGrades();
    } catch {
      showBlocked(new Error('앱을 불러오지 못했어요. 새로고침 해 주세요.'));
    }
  })();
})();
