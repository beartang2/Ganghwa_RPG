-- 실시간 갱신: logs 테이블 INSERT 를 구독 클라이언트에 브로드캐스트(Supabase Realtime postgres_changes).
-- 서버는 postgres 롤(BYPASSRLS)로 접속하므로 RLS 영향 없음 — anon 은 SELECT 만 허용한다.
-- (logs 는 게임 이벤트 로그라 공개 읽기 OK. 민감정보 없음.)
alter table logs enable row level security;
drop policy if exists "logs_anon_read" on logs;
create policy "logs_anon_read" on logs for select using (true);

-- supabase_realtime 퍼블리케이션에 logs 추가.
-- 로컬(pglite)엔 이 퍼블리케이션이 없으니 존재할 때만 실행. 이미 추가돼 있으면 무시.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin
      execute 'alter publication supabase_realtime add table logs';
    exception when duplicate_object then null;
    end;
  end if;
end $$;
