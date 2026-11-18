(() => {
  'use strict';

  const $ = (sel) => document.querySelector(sel);
  const TOKEN_KEY = 'quiz_admin_token';
  const XLSX_SOURCES = [
    'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js',
    'https://unpkg.com/xlsx@0.18.5/dist/xlsx.full.min.js',
  ];

  const state = {
    config: null,
    attempts: [],
    tab: 'status',
    statusGrade: 1,
    statusClass: 1,
    qGrade: 1,
    qPage: 0,            // 등록된 문항 목록의 현재 쪽 (0부터)
    questions: [],
    dialogSeat: null,
    bulkRows: null,
  };

  const Q_PAGE_SIZE = 5;       // 등록된 문항 목록은 5개씩 넘겨 가며 보고 삭제
  const NONSENSE_NEEDED = 5; // 넌센스 퀴즈(모든 학년 공통)는 전체 5개 이상 있어야 학생이 고를 수 있음
  const NONSENSE_TAB = 0;    // '등록된 문항' 탭: 1~6 = 학년별 일반 문항, 0 = 넌센스(공통)

  const STATUS_LABEL = { started: '풀이 중/중단', completed: '수료', failed: '미수료' };

  // ---------- 공통 ----------
  const getToken = () => { try { return sessionStorage.getItem(TOKEN_KEY); } catch { return null; } };
  const setToken = (t) => {
    try { t ? sessionStorage.setItem(TOKEN_KEY, t) : sessionStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ }
  };

  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toast.t);
    toast.t = setTimeout(() => { el.hidden = true; }, 2600);
  }

  async function api(path, { method = 'GET', body } = {}) {
    const headers = {};
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const res = await fetch(path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
    let data = {};
    try { data = await res.json(); } catch { /* ignore */ }
    if (res.status === 401 && path !== '/api/admin/login') {
      logout();
      throw new Error('로그인이 만료됐어요. 다시 로그인해 주세요.');
    }
    if (!res.ok) {
      const err = new Error(data.error || '문제가 생겼어요. 잠시 후 다시 시도해 주세요.');
      err.data = data;
      throw err;
    }
    return data;
  }

  function el(tag, props = {}, ...children) {
    const node = document.createElement(tag);
    Object.entries(props).forEach(([k, v]) => {
      if (k === 'class') node.className = v;
      else if (k === 'onclick') node.addEventListener('click', v);
      else node.setAttribute(k, v);
    });
    children.flat().forEach((c) => node.append(c));
    return node;
  }

  // ---------- 로그인 (관리자 코드) ----------
  function showLogin() {
    $('#login-view').hidden = false;
    $('#main-view').hidden = true;
  }

  function logout() {
    setToken(null);
    showLogin();
  }

  async function enter() {
    $('#login-view').hidden = true;
    $('#main-view').hidden = false;
    if (!state.config) state.config = await (await fetch('/api/config')).json();
    fillSelects();
    await Promise.all([loadAttempts(), loadQuestions()]);
    renderAll();
  }

  $('#login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('#login-error');
    err.hidden = true;
    try {
      const { token } = await api('/api/admin/login', {
        method: 'POST',
        body: { code: $('#login-code').value.trim() },
      });
      setToken(token);
      $('#login-code').value = '';
      await enter();
    } catch (ex) {
      err.textContent = ex.message;
      err.hidden = false;
      $('#login-code').select();
    }
  });
  $('#logout-btn').addEventListener('click', logout);

  // ---------- 탭 ----------
  $('#main-tabs').addEventListener('click', (e) => {
    const t = e.target.closest('[data-tab]');
    if (!t) return;
    state.tab = t.dataset.tab;
    renderAll();
  });

  function renderAll() {
    document.querySelectorAll('#main-tabs .tab').forEach((b) =>
      b.classList.toggle('active', b.dataset.tab === state.tab));
    $('#tab-status').hidden = state.tab !== 'status';
    $('#tab-questions').hidden = state.tab !== 'questions';
    if (state.tab === 'status') renderStatus(); else renderQuestions();
  }

  // ---------- 수료 현황 ----------
  async function loadAttempts() {
    state.attempts = (await api('/api/admin/attempts')).attempts;
  }

  const attemptsOf = (grade, classNo) =>
    state.attempts.filter((a) => a.grade === grade && (classNo == null || a.class_no === classNo));

  function renderStatus() {
    const { grades, maxNumber } = state.config;
    const info = grades.find((g) => g.grade === state.statusGrade);
    if (state.statusClass > info.classes) state.statusClass = 1;

    $('#status-grades').replaceChildren(
      ...grades.map((g) => {
        const done = attemptsOf(g.grade).filter((a) => a.status === 'completed').length;
        return el('button', {
          class: `tab${g.grade === state.statusGrade ? ' active' : ''}`,
          onclick: () => { state.statusGrade = g.grade; state.statusClass = 1; renderStatus(); },
        }, `${g.grade}학년`, el('small', {}, `수료 ${done}/${g.classes * maxNumber}`));
      }),
    );

    $('#status-classes').replaceChildren(
      ...Array.from({ length: info.classes }, (_, i) => i + 1).map((c) => {
        const done = attemptsOf(state.statusGrade, c).filter((a) => a.status === 'completed').length;
        return el('button', {
          class: `tab${c === state.statusClass ? ' active' : ''}`,
          onclick: () => { state.statusClass = c; renderStatus(); },
        }, `${c}반 (${done})`);
      }),
    );

    const list = attemptsOf(state.statusGrade, state.statusClass);
    const count = (s) => list.filter((a) => a.status === s).length;
    $('#status-summary').replaceChildren(
      el('span', { class: 'badge ok' }, `수료 ${count('completed')}`),
      el('span', { class: 'badge bad' }, `미수료 ${count('failed')}`),
      el('span', { class: 'badge warn' }, `풀이 중/중단 ${count('started')}`),
      el('span', { class: 'badge' }, `미참여 ${maxNumber - list.length}`),
    );

    const byNumber = new Map(list.map((a) => [a.number, a]));
    $('#seat-grid').replaceChildren(
      ...Array.from({ length: maxNumber }, (_, i) => i + 1).map((n) => {
        const a = byNumber.get(n);
        const sub = a
          ? `${STATUS_LABEL[a.status]}${a.attempt_count > 1 ? ` · ${a.attempt_count}회` : ''}`
          : '미참여';
        const btn = el('button', { class: `seat${a ? ` ${a.status}` : ''}`, type: 'button' },
          `${n}번`, el('small', {}, sub));
        if (a) btn.addEventListener('click', () => openSeatDialog(a));
        else btn.disabled = true;
        return btn;
      }),
    );
  }

  function openSeatDialog(a) {
    state.dialogSeat = a;
    $('#dlg-title').textContent = `${a.grade}학년 ${a.class_no}반 ${a.number}번`;
    const parts = [`상태: ${STATUS_LABEL[a.status]}`, `도전 ${a.attempt_count}회`];
    if (a.score != null) parts.push(`최근 점수: ${a.score} / 5`);
    if (a.submitted_at) parts.push(`제출: ${new Date(a.submitted_at).toLocaleString('ko-KR')}`);
    $('#dlg-detail').textContent = parts.join(' · ');

    const completed = a.status === 'completed';
    $('#dlg-reset').hidden = !completed;
    $('#dlg-note').hidden = completed;
    if (!completed) $('#dlg-note').textContent = '수료하지 못한 학생은 승인 없이 계속 다시 도전할 수 있어요.';
    $('#seat-dialog').showModal();
  }

  $('#dlg-close').addEventListener('click', () => $('#seat-dialog').close());
  $('#dlg-reset').addEventListener('click', async () => {
    const a = state.dialogSeat;
    if (!a) return;
    try {
      await api('/api/admin/reset', {
        method: 'POST',
        body: { grade: a.grade, classNo: a.class_no, number: a.number },
      });
      $('#seat-dialog').close();
      toast(`${a.grade}학년 ${a.class_no}반 ${a.number}번 재참여를 승인했어요.`);
      await loadAttempts();
      renderStatus();
    } catch (ex) {
      toast(ex.message);
    }
  });

  // ---------- 문항 관리 ----------
  async function loadQuestions() {
    state.questions = (await api('/api/admin/questions')).questions;
  }

  function fillSelects() {
    $('#q-subject-select').replaceChildren(
      ...state.config.subjects.map((s) => el('option', { value: s }, s)),
    );
    $('#q-grade-select').replaceChildren(
      ...state.config.grades.map((g) => el('option', { value: String(g.grade) }, `${g.grade}학년`)),
    );
  }

  const checked = (name) => document.querySelector(`input[name="${name}"]:checked`).value;

  function syncFormFields() {
    $('#mc-fields').hidden = checked('type') === 'ox';
    $('#ox-fields').hidden = checked('type') !== 'ox';
    const nonsense = checked('category') === 'nonsense';
    $('#subject-field').hidden = nonsense;   // 넌센스는 교과 없음
    $('#grade-field').hidden = nonsense;     // 넌센스는 모든 학년 공통이라 학년 선택 없음
    $('#common-note').hidden = !nonsense;
  }
  document.querySelectorAll('input[name="type"], input[name="category"]')
    .forEach((r) => r.addEventListener('change', syncFormFields));

  // 폼의 학년을 바꾸면 아래 '등록된 문항' 목록도 그 학년으로 맞춘다
  $('#q-grade-select').addEventListener('change', (e) => {
    state.qGrade = Number(e.target.value);
    state.qPage = 0;
    renderQuestions();
  });

  function renderQuestions() {
    const { grades } = state.config;
    const isNonsenseTab = state.qGrade === NONSENSE_TAB;
    if (!isNonsenseTab) $('#q-grade-select').value = String(state.qGrade);
    const nonsenseAll = state.questions.filter((q) => q.category === 'nonsense');
    const nonsenseKinds = new Set(nonsenseAll.map((q) => q.body)).size; // 같은 문제는 한 번만 센다 (서버와 동일)
    const regularOf = (g) => state.questions.filter((q) => q.grade === g && q.category === 'regular');

    $('#q-grades').replaceChildren(
      ...grades.map((g) =>
        el('button', {
          class: `tab${!isNonsenseTab && g.grade === state.qGrade ? ' active' : ''}`,
          onclick: () => { state.qGrade = g.grade; state.qPage = 0; renderQuestions(); },
        }, `${g.grade}학년`, el('small', {}, `${regularOf(g.grade).length}문항`)),
      ),
      el('button', {
        class: `tab${isNonsenseTab ? ' active' : ''}`,
        onclick: () => { state.qGrade = NONSENSE_TAB; state.qPage = 0; renderQuestions(); },
      }, '넌센스 (공통)', el('small', {}, `${nonsenseAll.length}문항`)),
    );

    const list = isNonsenseTab ? nonsenseAll : regularOf(state.qGrade);
    const ox = list.filter((q) => q.type === 'ox').length;
    const mc = list.filter((q) => q.type === 'mc').length;
    $('#q-counts').replaceChildren(
      ...(isNonsenseTab
        ? [el('span', { class: 'badge' }, `넌센스 ${nonsenseAll.length}개 (모든 학년 공통)`)]
        : [
          el('span', { class: 'badge' }, `일반 O X ${ox}개`),
          el('span', { class: 'badge' }, `일반 객관식 ${mc}개`),
          el('span', { class: 'badge' }, `넌센스 ${nonsenseAll.length}개 (공통)`),
        ]),
    );
    const warn = $('#q-warn');
    const notes = [];
    if (!isNonsenseTab) {
      const lacks = [];
      if (ox < 2) lacks.push(`일반 O X 퀴즈 ${2 - ox}개`);
      if (mc < 3) lacks.push(`일반 객관식 ${3 - mc}개`);
      if (lacks.length) notes.push(`일반 퀴즈를 열려면 ${lacks.join(', ')}가 더 필요해요. (O X 2 + 객관식 3 고정)`);
    }
    if (nonsenseKinds < NONSENSE_NEEDED) notes.push(`넌센스 퀴즈(모든 학년 공통)를 열려면 ${NONSENSE_NEEDED - nonsenseKinds}개가 더 필요해요. (5문제 출제)`);
    warn.hidden = notes.length === 0;
    warn.replaceChildren(...notes.map((t) => el('div', {}, t)));

    // 5개씩 끊어서 보여 주고, 이전/다음으로 넘긴다. (삭제 후 쪽 수가 줄면 자동으로 맞춤)
    const pages = Math.max(1, Math.ceil(list.length / Q_PAGE_SIZE));
    state.qPage = Math.min(Math.max(0, state.qPage), pages - 1);
    const start = state.qPage * Q_PAGE_SIZE;
    const pageItems = list.slice(start, start + Q_PAGE_SIZE);

    const buildPager = () => el('div', { class: 'pager' },
      el('button', {
        class: 'btn secondary small', type: 'button',
        ...(state.qPage === 0 ? { disabled: '' } : {}),
        onclick: () => { state.qPage -= 1; renderQuestions(); },
      }, '◀ 이전'),
      el('span', { class: 'pager-info' }, `${state.qPage + 1} / ${pages}쪽 · 전체 ${list.length}개`),
      el('button', {
        class: 'btn secondary small', type: 'button',
        ...(state.qPage >= pages - 1 ? { disabled: '' } : {}),
        onclick: () => { state.qPage += 1; renderQuestions(); },
      }, '다음 ▶'),
    );
    const showPager = list.length > 0;
    $('#q-pager-top').replaceChildren(...(showPager ? [buildPager()] : []));
    $('#q-pager').replaceChildren(...(showPager ? [buildPager()] : []));
    $('#q-empty').hidden = showPager;
    $('#q-empty').textContent = isNonsenseTab ? '등록된 넌센스 문항이 없어요.' : '이 학년에는 등록된 일반 문항이 없어요.';

    $('#q-list').replaceChildren(
      ...pageItems.map((q, i) => {
        const meta = el('div', { class: 'meta' },
          el('span', { class: 'q-no' }, `${start + i + 1}번`),
          q.category === 'nonsense'
            ? el('span', { class: 'chip nonsense' }, '넌센스')
            : el('span', { class: 'chip' }, q.subject),
          el('span', { class: 'chip type' }, q.type === 'ox' ? 'O X' : '객관식'),
          el('button', { class: 'btn danger small', style: 'margin-left:auto', onclick: () => deleteQuestion(q) }, '삭제'));
        const item = el('li', { class: 'q-item' }, meta, el('div', {}, q.body));
        if (q.type === 'mc') {
          item.append(el('ol', {}, ...q.choices.map((c, i) => el('li', { class: i === q.answer ? 'correct' : '' }, c))));
        } else {
          item.append(el('div', { class: 'answer' }, `정답: ${q.answer === 0 ? 'O' : 'X'}`));
        }
        return item;
      }),
    );
  }

  $('#q-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('#q-error');
    err.hidden = true;
    const type = checked('type');
    const body = {
      grade: Number($('#q-grade-select').value),
      category: checked('category'),
      type,
      subject: $('#q-subject-select').value,
      body: $('#q-body-input').value,
    };
    if (type === 'ox') {
      body.answer = Number(checked('oxans'));
    } else {
      body.choices = [...document.querySelectorAll('.mc-text')].map((i) => i.value);
      body.answer = Number(checked('mcans'));
    }
    try {
      await api('/api/admin/questions', { method: 'POST', body });
      $('#q-body-input').value = '';
      document.querySelectorAll('.mc-text').forEach((i) => { i.value = ''; });
      const common = body.category === 'nonsense';
      toast(common ? '넌센스(공통) 문항을 추가했어요.' : `${body.grade}학년 문항을 추가했어요.`);
      state.qGrade = common ? NONSENSE_TAB : body.grade;
      state.qPage = Number.MAX_SAFE_INTEGER; // 렌더링할 때 마지막 쪽으로 맞춰짐
      await loadQuestions();
      renderQuestions();
    } catch (ex) {
      err.textContent = ex.message;
      err.hidden = false;
    }
  });

  async function deleteQuestion(q) {
    const preview = q.body.length > 40 ? `${q.body.slice(0, 40)}…` : q.body;
    if (!confirm(`이 문항을 삭제할까요?\n\n${preview}`)) return;
    try {
      await api(`/api/admin/questions?id=${q.id}`, { method: 'DELETE' });
      await loadQuestions();
      renderQuestions();
      toast('삭제했어요.');
    } catch (ex) {
      toast(ex.message);
    }
  }

  // ---------- 엑셀 일괄 업로드 ----------
  let xlsxPromise = null;

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = () => { s.remove(); reject(new Error('load failed')); };
      document.head.append(s);
    });
  }

  // 엑셀 읽기 도구(SheetJS)는 업로드할 때 처음 한 번만 불러온다
  function ensureXlsx() {
    if (window.XLSX) return Promise.resolve();
    if (!xlsxPromise) {
      xlsxPromise = XLSX_SOURCES.reduce(
        (p, src) => p.catch(() => loadScript(src)),
        Promise.reject(new Error('start')),
      ).then(() => {
        if (!window.XLSX) throw new Error('XLSX missing');
      }).catch(() => {
        xlsxPromise = null;
        throw new Error('엑셀 읽기 도구를 불러오지 못했어요. 인터넷 연결을 확인하고 다시 시도해 주세요.');
      });
    }
    return xlsxPromise;
  }

  const isBlankRow = (row) => Object.values(row).every((v) => String(v ?? '').trim() === '');

  async function readWorkbookRows(file) {
    await ensureXlsx();
    const wb = window.XLSX.read(await file.arrayBuffer(), { type: 'array' });
    const name = wb.SheetNames.includes('문항') ? '문항' : wb.SheetNames[0];
    // blankrows: 빈 줄도 포함해야 배열 순번 = 엑셀 행 번호(−2)가 맞아서 오류 행 번호를 정확히 알려 줄 수 있다
    const rows = window.XLSX.utils.sheet_to_json(wb.Sheets[name], { defval: '', blankrows: true });
    while (rows.length && isBlankRow(rows[rows.length - 1])) rows.pop();
    return rows;
  }

  function showBulkResult(node) {
    $('#bulk-result').replaceChildren(node);
  }

  $('#bulk-file').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    state.bulkRows = null;
    $('#bulk-submit').hidden = true;
    if (!file) { showBulkResult(document.createTextNode('')); return; }
    try {
      showBulkResult(el('p', { class: 'muted' }, '파일을 검사하는 중이에요…'));
      const rows = await readWorkbookRows(file);
      if (!rows.length) throw new Error('읽을 문항이 없어요. 양식의 2행부터 입력했는지 확인해 주세요.');
      const r = await api('/api/admin/questions-bulk', { method: 'POST', body: { rows, dryRun: true } });
      const box = el('div', {});
      if (r.errors.length) {
        box.append(
          el('p', { class: 'error-text' }, `오류가 ${r.errors.length}건 있어요. 고친 뒤 다시 올려 주세요. (오류가 있으면 등록되지 않아요)`),
          el('ul', {}, ...r.errors.slice(0, 50).map((x) => el('li', {}, x.row ? `${x.row}행: ${x.message}` : x.message))),
        );
        if (r.errors.length > 50) box.append(el('p', { class: 'muted' }, `…외 ${r.errors.length - 50}건`));
      } else if (r.count === 0) {
        box.append(el('p', { class: 'error-text' }, '등록할 문항이 없어요.'));
      } else {
        box.append(el('p', {}, `검사 완료! 일반 ${r.regular}개, 넌센스 ${r.nonsense}개 (총 ${r.count}개)를 등록할 수 있어요.`));
        state.bulkRows = rows;
        $('#bulk-submit').hidden = false;
      }
      showBulkResult(box);
    } catch (ex) {
      showBulkResult(el('p', { class: 'error-text' }, ex.message));
    }
  });

  $('#bulk-submit').addEventListener('click', async () => {
    if (!state.bulkRows) return;
    const btn = $('#bulk-submit');
    btn.disabled = true;
    try {
      const r = await api('/api/admin/questions-bulk', { method: 'POST', body: { rows: state.bulkRows } });
      toast(`${r.inserted}개 문항을 등록했어요.`);
      state.bulkRows = null;
      btn.hidden = true;
      $('#bulk-file').value = '';
      showBulkResult(el('p', { class: 'muted' }, `${r.inserted}개 등록 완료!`));
      await loadQuestions();
      renderQuestions();
    } catch (ex) {
      showBulkResult(el('p', { class: 'error-text' }, ex.message));
    } finally {
      btn.disabled = false;
    }
  });

  // ---------- 시작 ----------
  syncFormFields();
  if (getToken()) {
    enter().catch(() => showLogin());
  } else {
    showLogin();
  }
})();
