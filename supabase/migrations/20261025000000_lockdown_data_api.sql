-- 보안 잠금: Supabase Data API(REST/GraphQL)로 게임 테이블을 직접 읽고 쓰지 못하게 막는다.
--
-- 배경: /api/config 가 프론트(Realtime·이메일 로그인)용으로 anon 키를 공개한다. anon 키는 원래
-- 공개용이지만, public 스키마 테이블에 RLS 가 꺼져 있고 anon 권한(GRANT)이 남아 있으면
-- 그 키만으로 https://<ref>.supabase.co/rest/v1/<table> 에서 행을 읽고/고치고/지울 수 있다.
--   sessions → 남의 세션 토큰 탈취, players.id(=sha256('pin:'+PIN), 8자리라 역산 쉬움) → PIN 노출,
--   players UPDATE → 골드 조작 등.
--
-- 서버(Vercel 함수)는 DATABASE_URL 의 postgres 롤 = 테이블 소유자로 직접 접속한다.
-- 소유자는 RLS 를 우회하므로(FORCE 를 쓰지 않음) 게임 로직은 영향 없다.
-- 결과적으로 anon/authenticated 가 할 수 있는 건 logs 읽기(Realtime 구독)뿐이다.
--
-- 멱등: 여러 번 적용해도 안전. 로컬(pglite)엔 anon/authenticated 롤이 없으니 있을 때만 권한 처리.

alter table players       enable row level security;
alter table player_daily  enable row level security;
alter table player_limits enable row level security;
alter table parties       enable row level security;
alter table meta          enable row level security;
alter table sessions      enable row level security;
alter table rate_buckets  enable row level security;
-- logs 는 20260815000000_realtime.sql 에서 이미 RLS + 공개 읽기 정책이 걸려 있다.
-- 위 테이블들엔 정책을 만들지 않는다 = anon/authenticated 는 RLS 로 0행.

do $$
declare r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      -- RLS 와 별개로 권한 자체도 회수(이중 잠금). TRUNCATE 는 RLS 가 막지 못하므로 특히 중요.
      execute format('revoke all on table players, player_daily, player_limits, parties, meta, sessions, rate_buckets, logs from %I', r);
      execute format('revoke all on sequence logs_seq_seq from %I', r);
      -- Realtime(postgres_changes)은 구독자 롤에 SELECT 권한이 있어야 이벤트를 보낸다.
      -- 2026-05 이후 생성된 프로젝트는 새 테이블에 anon 권한이 자동 부여되지 않아 이 GRANT 가 없으면
      -- Realtime 이 조용히 실패(→ 5초 폴링 폴백)한다. logs 는 게임 이벤트 로그라 공개해도 무방.
      execute format('grant select on table logs to %I', r);
    end if;
  end loop;
end $$;
