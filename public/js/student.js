(() => {
  'use strict';

  const $ = (sel) => document.querySelector(sel);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const RETURN_SECONDS = 5; // 수료/미수료 안내 후 처음 화면으로 자동 이동

  const state = {
    config: null,
    grade: null,
    classNo: null,
    number: null,
    token: null,
    track: null,           // 'regular'(일반 퀴즈) | 'nonsense'(넌센스 퀴즈)
    questions: [],         // 5문제 (일반/넌센스 공통)
    answers: [],
    index: 0,
    inProgress: false,
  };
  let returnTimer = null;

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

  // ---------- 3) 번호 확인 → 퀴즈 종류 선택 → 5초 안내 → 시작 ----------
  // 넌센스 / 일반 중 학생이 직접 고른다. 준비되지 않은 쪽은 눌러지지 않는다. (처음 화면으로 → null)
  function chooseTrack(check) {
    return new Promise((resolve) => {
      const setup = (sel, available, desc, track) => {
        const b = $(sel);
        b.disabled = !available;
        b.querySelector('small').textContent = available ? desc : '아직 준비 중이에요';
        b.onclick = () => resolve(track);
      };
      setup('#track-nonsense', check.nonsenseAvailable === true, '재미있는 말장난 문제 5개', 'nonsense');
      setup('#track-regular', check.regularAvailable === true, '교과 문제 5개 (객관식 3 + O X 2)', 'regular');
      $('#track-home').onclick = () => resolve(null);
      show('track');
    });
  }

  async function startFlow() {
    const seat = { grade: state.grade, classNo: state.classNo, number: state.number };
    $('#seat-confirm').disabled = true;
    try {
      const check = await post('/api/student/check', seat);
      const track = await chooseTrack(check);
      if (!track) { reset(); return; }

      show('countdown');
      for (let n = 5; n >= 1; n--) {
        $('#count-num').textContent = String(n);
        await sleep(1000);
      }

      const data = await post('/api/student/start', { ...seat, track });
      state.token = data.token;
      state.track = data.track === 'nonsense' ? 'nonsense' : 'regular';
      state.questions = data.questions;
      state.answers = new Array(data.questions.length).fill(null);
      state.index = 0;
      state.inProgress = true;
      renderQuestion();
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

  // ---------- 문제 풀이 (일반 / 넌센스 공통: 정답은 제출 후 서버가 채점) ----------
  const typeLabel = (q) => (q.type === 'ox' ? 'O X 퀴즈' : '객관식');
  const optionLabel = (q, text, i) => (q.type === 'ox' ? text : `${i + 1}. ${text}`);

  function renderQuestion() {
    const q = state.questions[state.index];
    const total = state.questions.length;
    const nonsense = state.track === 'nonsense';

    $('#progress').replaceChildren(
      ...Array.from({ length: total }, (_, i) => {
        const s = document.createElement('span');
        if (i <= state.index) s.className = 'done';
        return s;
      }),
    );
    const subject = $('#q-subject');
    subject.textContent = nonsense ? '넌센스' : q.subject;
    subject.className = nonsense ? 'chip nonsense' : 'chip';
    $('#q-type').textContent = `${state.index + 1} / ${total} · ${typeLabel(q)}`;
    $('#q-body').textContent = q.body;
    $('#quiz-error').hidden = true;

    const box = $('#q-options');
    box.className = `options ${q.type}`;
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
        startReturnTimer($('#done-timer'));
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

  // ---------- 수료 / 미수료 후: 안내 → 5초 뒤 처음 화면으로 (버튼으로 바로 이동도 가능) ----------
  function startReturnTimer(labelEl) {
    clearInterval(returnTimer);
    let left = RETURN_SECONDS;
    const label = () => { labelEl.textContent = `${left}초 뒤에 처음 화면으로 돌아가요.`; };
    label();
    returnTimer = setInterval(() => {
      left -= 1;
      if (left <= 0) reset(); else label();
    }, 1000);
  }

  function showFail(result) {
    $('#fail-score').textContent = `${result.total}문제 중 ${result.score}문제를 맞혔어요.`;
    startReturnTimer($('#fail-timer'));
    show('fail');
  }

  // ---------- 처음으로 ----------
  function reset() {
    clearInterval(returnTimer);
    state.grade = state.classNo = state.number = state.token = state.track = null;
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
  $('#done-home').addEventListener('click', reset);
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
