-- 속도제한(토큰버킷) — 서버리스는 인메모리 Map 이 인스턴스 간 공유가 안 되므로
-- 버킷 상태를 행으로 저장한다. key 예: 'act:<계정>', 'lnick:<닉>', 'lip:<IP>'
create table if not exists rate_buckets (
  key     text primary key,
  tokens  double precision not null,
  updated bigint not null            -- ms
);
create index if not exists idx_rate_buckets_updated on rate_buckets(updated);
