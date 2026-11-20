-- Neon SQL Editor에 그대로 붙여넣어 실행하세요.
-- 여러 번 실행해도 안전하며, 이전 버전 스키마를 이미 실행했다면 이 파일을 다시 실행하면 업그레이드됩니다.

CREATE TABLE IF NOT EXISTS questions (
  id         SERIAL PRIMARY KEY,
  grade      SMALLINT    NOT NULL CHECK (grade BETWEEN 1 AND 6),  -- 넌센스(category='nonsense')는 모든 학년 공통: 값은 1로 채우고 출제 때 무시
  category   TEXT        NOT NULL DEFAULT 'regular' CHECK (category IN ('regular', 'nonsense')),
  type       TEXT        NOT NULL CHECK (type IN ('ox', 'mc')),
  subject    TEXT        NOT NULL DEFAULT '기타',
  body       TEXT        NOT NULL,
  choices    JSONB,                       -- 객관식: 보기 4개 배열 / OX: NULL
  answer     SMALLINT    NOT NULL,        -- OX: 0=O, 1=X / 객관식: 0~3 (보기 순번)
  is_active  BOOLEAN     NOT NULL DEFAULT TRUE,   -- 삭제는 FALSE 처리(이미 출제된 기록 보존)
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT questions_shape CHECK (
    (type = 'ox' AND choices IS NULL AND answer IN (0, 1))
    OR
    (type = 'mc' AND jsonb_typeof(choices) = 'array'
       AND jsonb_array_length(choices) = 4 AND answer BETWEEN 0 AND 3)
  )
);

-- (업그레이드용) 이전 버전에는 category 컬럼이 없었습니다.
ALTER TABLE questions
  ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT 'regular'
  CHECK (category IN ('regular', 'nonsense'));

CREATE INDEX IF NOT EXISTS questions_grade_idx ON questions (grade, category) WHERE is_active;

-- 학생 1명(학년/반/번호)당 기록은 1건만 유지하고, 도전할 때마다 갱신합니다.
--  · 수료(completed)한 학생은 관리자가 기록을 지워 주기 전까지 다시 참여할 수 없음
--  · 미수료(failed) / 풀이 중 이탈(started)은 몇 번이든 다시 도전 가능 (attempt_count 증가)
CREATE TABLE IF NOT EXISTS attempts (
  id            SERIAL PRIMARY KEY,
  grade         SMALLINT NOT NULL CHECK (grade BETWEEN 1 AND 6),
  class_no      SMALLINT NOT NULL CHECK (class_no BETWEEN 1 AND 5),
  number        SMALLINT NOT NULL CHECK (number BETWEEN 1 AND 30),
  status        TEXT     NOT NULL DEFAULT 'started'
                CHECK (status IN ('started', 'completed', 'failed')),
  question_ids  INT[]    NOT NULL,        -- 이번 도전에서 출제된 5문제 (출제 순서대로)
  score         SMALLINT,
  attempt_count INT      NOT NULL DEFAULT 1,
  started_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  submitted_at  TIMESTAMPTZ,
  CONSTRAINT attempts_class_range CHECK (
    class_no <= CASE WHEN grade IN (3, 5, 6) THEN 4 ELSE 5 END
  ),
  CONSTRAINT attempts_one_per_student UNIQUE (grade, class_no, number)
);

-- (업그레이드용) 도전 횟수 컬럼
ALTER TABLE attempts ADD COLUMN IF NOT EXISTS attempt_count INT NOT NULL DEFAULT 1;

-- 관리자 코드 무작위 대입 방지용 실패 기록
CREATE TABLE IF NOT EXISTS admin_login_failures (
  id        SERIAL PRIMARY KEY,
  failed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  device    TEXT,   -- 로그인을 시도한 기기 번호(브라우저가 만든 임의 값): 기기마다 실패 횟수를 따로 센다
  ip        TEXT    -- 같은 네트워크(IP)에서 나온 실패의 합계를 세는 데 사용
);
-- 예전 버전으로 이미 만들어 둔 DB를 위한 보충 (여러 번 실행해도 안전)
ALTER TABLE admin_login_failures ADD COLUMN IF NOT EXISTS device TEXT;
ALTER TABLE admin_login_failures ADD COLUMN IF NOT EXISTS ip TEXT;
