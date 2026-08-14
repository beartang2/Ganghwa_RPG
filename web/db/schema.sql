-- 강화 RPG — Supabase(Postgres) 스키마
-- SQLite 저장 계층(server.js)과 동일한 소유권 규칙을 그대로 옮긴다:
--   players       — 캐릭터 상태 (nick/level/gold 컬럼 + 나머지는 data JSONB)
--   player_daily  — 유저×날짜 일일 카운터 (사냥/싸움/레이드/파괴/출석). 날짜별 이력 보존
--   player_limits — 유저별 일일 상한 오버라이드 (NULL = CONFIG 기본값)
--   parties/logs/meta — 파티/로그/메타
--   sessions      — 토큰→계정 (인메모리 Map 대체: 서버리스는 인스턴스 간 공유 불가)
-- 규칙: 컬럼/전용 테이블이 소유한 필드는 data JSONB 에 중복 저장하지 않는다.

create table if not exists players (
  id    text primary key,               -- pinKey = sha256('pin:'||pin)
  nick  text,
  level integer not null default 0,
  gold  bigint  not null default 0,
  data  jsonb   not null default '{}'::jsonb
);
create index if not exists idx_players_nick  on players(nick);
create index if not exists idx_players_level on players(level desc);
create index if not exists idx_players_gold  on players(gold desc);

create table if not exists player_daily (
  player_id   text    not null,
  day         text    not null,          -- 'YYYY-MM-DD'
  hunts_used  integer not null default 0,
  fights_used integer not null default 0,
  raids_used  integer not null default 0,
  destroys    integer not null default 0,
  attended    integer not null default 0,
  primary key (player_id, day)
);
create index if not exists idx_player_daily_day on player_daily(day);

create table if not exists player_limits (
  player_id    text primary key,
  daily_hunts  integer,                  -- NULL = CONFIG.dailyHunts
  daily_fights integer,
  daily_raids  integer,
  note         text,
  updated_at   bigint
);

create table if not exists parties (id text primary key, data jsonb not null);

create table if not exists logs (
  seq  bigserial primary key,
  ts   bigint,
  text text
);

create table if not exists meta (k text primary key, v text);

-- 세션: 인메모리 Map 을 대체. 오래된 토큰은 seen 기준으로 주기적 정리한다.
create table if not exists sessions (
  token     text primary key,
  player_id text   not null,
  seen      bigint not null
);
create index if not exists idx_sessions_seen on sessions(seen);
