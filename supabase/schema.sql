-- ============================================================
-- 儿童英语学习助手 — Supabase 数据库结构 + 行级安全(RLS)
--
-- 多用户隔离原则：所有数据都归属到某个孩子(child)，而孩子归属到
-- 某个家长账号(owner = auth.uid())。RLS 强制每个家长只能读写自己
-- 名下的数据，互相完全隔离。这是开放给其他用户使用的安全基石。
--
-- 在 Supabase 控制台的 SQL Editor 里执行本文件即可。
-- ============================================================

-- 孩子档案：owner 指向登录用户
create table if not exists children (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);

-- 句子（保留语境）
create table if not exists sentences (
  id uuid primary key default gen_random_uuid(),
  child_id uuid not null references children (id) on delete cascade,
  text text not null,
  created_at timestamptz not null default now()
);

-- 单词词典 + SM-2 记忆状态
create table if not exists words (
  id uuid primary key default gen_random_uuid(),
  child_id uuid not null references children (id) on delete cascade,
  text text not null,
  lang text not null default 'en',
  sentence_ids uuid[] not null default '{}',
  first_learned_at timestamptz not null default now(),
  example_sentence text,
  interval int not null default 1,
  ef real not null default 2.5,
  repetitions int not null default 0,
  due_date date not null,
  last_grade text,
  last_reviewed_at timestamptz,
  unique (child_id, text)
);

-- 兼容旧库：若 words 表已存在但缺少这些列，补上（安全幂等）
alter table words add column if not exists example_sentence text;
alter table words add column if not exists lang text not null default 'en';

-- 复习日志
create table if not exists review_logs (
  id uuid primary key default gen_random_uuid(),
  child_id uuid not null references children (id) on delete cascade,
  word_id uuid not null references words (id) on delete cascade,
  grade text not null,
  reviewed_at timestamptz not null default now()
);

-- 用户建议 / 需求反馈（独立表，不挂在某个孩子下，直接归属登录用户）
create table if not exists feedback (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null default auth.uid() references auth.users (id) on delete cascade,
  content text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_sentences_child on sentences (child_id);
create index if not exists idx_words_child on words (child_id);
create index if not exists idx_words_due on words (child_id, due_date);
create index if not exists idx_logs_child on review_logs (child_id);
create index if not exists idx_feedback_owner on feedback (owner);

-- ============================================================
-- 启用行级安全
-- ============================================================
alter table children enable row level security;
alter table sentences enable row level security;
alter table words enable row level security;
alter table review_logs enable row level security;
alter table feedback enable row level security;

-- 辅助：判断某个 child 是否属于当前登录用户
-- (用于子表策略；以 child_id 反查 children.owner)
create or replace function owns_child(cid uuid)
returns boolean
language sql
security definer
stable
as $$
  select exists (
    select 1 from children c where c.id = cid and c.owner = auth.uid()
  );
$$;

-- children：只能操作自己拥有的
drop policy if exists children_all on children;
create policy children_all on children
  for all using (owner = auth.uid()) with check (owner = auth.uid());

-- sentences
drop policy if exists sentences_all on sentences;
create policy sentences_all on sentences
  for all using (owns_child(child_id)) with check (owns_child(child_id));

-- words
drop policy if exists words_all on words;
create policy words_all on words
  for all using (owns_child(child_id)) with check (owns_child(child_id));

-- review_logs
drop policy if exists logs_all on review_logs;
create policy logs_all on review_logs
  for all using (owns_child(child_id)) with check (owns_child(child_id));

-- feedback：每个用户只能写入并查看自己提交的反馈（管理员在后台 SQL 可查全部）
drop policy if exists feedback_insert on feedback;
create policy feedback_insert on feedback
  for insert with check (owner = auth.uid());
drop policy if exists feedback_select on feedback;
create policy feedback_select on feedback
  for select using (owner = auth.uid());
