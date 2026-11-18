// 학급 구성/문항 규칙의 단일 기준(서버 검증과 화면이 모두 이 값을 사용합니다)

export const CLASSES_PER_GRADE = { 1: 5, 2: 5, 3: 4, 4: 5, 5: 4, 6: 4 };
export const MAX_NUMBER = 30;
export const SUBJECTS = [
  '국어', '수학', '사회', '과학', '영어', '도덕',
  '통합교과', '실과', '체육', '음악', '미술', '안전', '기타',
];
export const QUIZ_LAYOUT = { ox: 2, mc: 3 }; // 정규 퀴즈: 총 5문제
export const NONSENSE_COUNT = 5;             // 넌센스 퀴즈 문제 수 (일반 퀴즈처럼 모두 맞히면 수료)
export const NONSENSE_SUBJECT = '넌센스';
// 넌센스 퀴즈는 모든 학년이 함께 푸는 공통 문제다. DB의 grade 칸은 비워 둘 수 없어서 1로 채워 저장하고,
// 출제·집계할 때는 이 값을 보지 않는다.
export const NONSENSE_GRADE = 1;
export const CATEGORIES = ['regular', 'nonsense'];
export const ALREADY_MESSAGE = '이미 수료를 완료했어요. 다시 참여하려면 선생님께 말씀드려 주세요.';

function toInt(v) {
  if (typeof v === 'number' && Number.isInteger(v)) return v;
  if (typeof v === 'string' && /^\d{1,3}$/.test(v)) return Number(v);
  return NaN;
}

// 학년/반/번호 검증: 범위를 벗어나면 null (로그인 불가)
export function parseSeat(input) {
  const grade = toInt(input?.grade);
  const classNo = toInt(input?.classNo);
  const number = toInt(input?.number);
  const classes = CLASSES_PER_GRADE[grade];
  if (!classes) return null;
  if (!Number.isInteger(classNo) || classNo < 1 || classNo > classes) return null;
  if (!Number.isInteger(number) || number < 1 || number > MAX_NUMBER) return null;
  return { grade, classNo, number };
}

// 관리자 문항 입력 검증 (화면 입력/엑셀 업로드 공통)
export function validateQuestion(input) {
  const category = input?.category ?? 'regular';
  if (!CATEGORIES.includes(category)) return { error: '구분(정규/넌센스)을 확인해 주세요.' };

  // 일반(정규) 문항은 학년별, 넌센스 문항은 학년과 무관(공통)
  let grade = NONSENSE_GRADE;
  if (category === 'regular') {
    grade = toInt(input?.grade);
    if (!CLASSES_PER_GRADE[grade]) return { error: '학년을 확인해 주세요.' };
  }

  const type = input?.type;
  if (type !== 'ox' && type !== 'mc') return { error: '문제 유형을 선택해 주세요.' };

  const body = String(input?.body ?? '').trim();
  if (!body || body.length > 300) return { error: '문제 내용을 1~300자로 입력해 주세요.' };

  let subject = input?.subject;
  if (category === 'nonsense') subject = NONSENSE_SUBJECT;
  else if (!SUBJECTS.includes(subject)) return { error: '교과를 선택해 주세요.' };

  const answer = toInt(input?.answer);
  if (type === 'ox') {
    if (answer !== 0 && answer !== 1) return { error: '정답(O 또는 X)을 선택해 주세요.' };
    return { value: { grade, category, type, subject, body, choices: null, answer } };
  }

  const choices = Array.isArray(input?.choices)
    ? input.choices.map((c) => String(c ?? '').trim())
    : [];
  if (choices.length !== 4 || choices.some((c) => !c || c.length > 100)) {
    return { error: '보기 4개를 모두 입력해 주세요. (각 100자 이내)' };
  }
  if (new Set(choices).size !== 4) return { error: '보기는 서로 달라야 해요.' };
  if (![0, 1, 2, 3].includes(answer)) return { error: '정답 보기를 선택해 주세요.' };
  return { value: { grade, category, type, subject, body, choices, answer } };
}

export function publicConfig() {
  return {
    grades: Object.entries(CLASSES_PER_GRADE).map(([g, c]) => ({ grade: Number(g), classes: c })),
    maxNumber: MAX_NUMBER,
    subjects: SUBJECTS,
  };
}
