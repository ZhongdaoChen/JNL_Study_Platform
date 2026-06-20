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
  needs_spelling boolean not null default false,
  interval int not null default 1,
  ef real not null default 2.5,
  repetitions real not null default 0,
  due_date date not null,
  last_grade text,
  last_reviewed_at timestamptz,
  pending_retry_count int not null default 0,
  volatility_rate int not null default 0,
  spelling_interval int not null default 0,
  spelling_ef real not null default 2.5,
  spelling_repetitions real not null default 0,
  spelling_due_date date not null default current_date,
  spelling_last_grade text,
  spelling_last_reviewed_at timestamptz,
  spelling_pending_retry_count int not null default 0,
  unique (child_id, text)
);

-- 兼容旧库：若 words 表已存在但缺少这些列，补上（安全幂等）
alter table words add column if not exists example_sentence text;
alter table words add column if not exists lang text not null default 'en';
alter table words add column if not exists needs_spelling boolean not null default false;
alter table words add column if not exists spelling_interval int not null default 0;
alter table words add column if not exists spelling_ef real not null default 2.5;
alter table words add column if not exists spelling_repetitions real not null default 0;
alter table words add column if not exists spelling_due_date date not null default current_date;
alter table words add column if not exists spelling_last_grade text;
alter table words add column if not exists spelling_last_reviewed_at timestamptz;
alter table words add column if not exists pending_retry_count int not null default 0;
alter table words add column if not exists volatility_rate int not null default 0;
alter table words add column if not exists spelling_pending_retry_count int not null default 0;
alter table words alter column repetitions type real using repetitions::real;
alter table words alter column spelling_repetitions type real using spelling_repetitions::real;

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

-- 用户配置（倒计时、每日上限等），按登录用户一份保存，支持跨设备同步
create table if not exists user_settings (
  owner uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  countdown_sec int not null default 0,
  review_limit_en_read int not null default 0,
  review_limit_en_spell int not null default 0,
  review_limit_zh_read int not null default 0,
  review_limit_zh_write int not null default 0,
  updated_at timestamptz not null default now()
);

create index if not exists idx_sentences_child on sentences (child_id);
create index if not exists idx_words_child on words (child_id);
create index if not exists idx_words_due on words (child_id, due_date);
create index if not exists idx_words_spelling_due on words (child_id, spelling_due_date);
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
alter table user_settings enable row level security;

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

-- user_settings：每个用户只能读写自己的配置
drop policy if exists user_settings_all on user_settings;
create policy user_settings_all on user_settings
  for all using (owner = auth.uid()) with check (owner = auth.uid());

-- ============================================================
-- 管理员总览（仅管理员邮箱可取到数据）
--
-- 这些函数用 security definer 以函数属主(postgres)身份执行，从而能
-- 读取 auth.users 并绕过各表 RLS，做跨用户汇总。函数内部用 is_admin()
-- 校验调用者邮箱，非管理员调用只会拿到空结果，保证安全。
-- ============================================================

create or replace function is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((auth.jwt() ->> 'email'), '') = 'chenzhongdao0730@gmail.com';
$$;

-- 各用户：最后登录时间、注册时间、录入单词数（中英分列）
create or replace function admin_user_stats()
returns table(
  email text,
  last_sign_in_at timestamptz,
  created_at timestamptz,
  word_count bigint,
  en_count bigint,
  zh_count bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not is_admin() then return; end if;
  return query
    select u.email::text,
           u.last_sign_in_at,
           u.created_at,
           count(w.id) as word_count,
           count(w.id) filter (where w.lang = 'en') as en_count,
           count(w.id) filter (where w.lang = 'zh') as zh_count
    from auth.users u
    left join children c on c.owner = u.id
    left join words w on w.child_id = c.id
    group by u.id, u.email, u.last_sign_in_at, u.created_at
    order by u.last_sign_in_at desc nulls last;
end;
$$;

-- 各用户录入的单词/单字明细
create or replace function admin_words()
returns table(
  email text,
  child_name text,
  lang text,
  word text,
  repetitions real,
  due_date date,
  first_learned_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not is_admin() then return; end if;
  return query
    select u.email::text, c.name, w.lang, w.text, w.repetitions, w.due_date, w.first_learned_at
    from words w
    join children c on c.id = w.child_id
    join auth.users u on u.id = c.owner
    order by u.email, w.first_learned_at desc;
end;
$$;

-- 所有用户提交的建议/需求
create or replace function admin_feedback()
returns table(
  email text,
  content text,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not is_admin() then return; end if;
  return query
    select u.email::text, f.content, f.created_at
    from feedback f
    join auth.users u on u.id = f.owner
    order by f.created_at desc;
end;
$$;

-- 把当前用户的学习数据共享（复制并并集去重）到另一个已注册邮箱账号
create or replace function share_data_to_email(target_email text)
returns table(
  created_children int,
  inserted_sentences int,
  upserted_words int,
  inserted_logs int
)
language plpgsql
security definer
set search_path = public
as $$
declare
  src_uid uuid := auth.uid();
  dest_uid uuid;
  src_child record;
  src_sentence record;
  src_word record;
  src_log record;
  target_child_id uuid;
  target_word_id uuid;
  existing_word record;
  mapped_sentence_ids uuid[];
  latest_last_reviewed_at timestamptz;
  latest_last_grade text;
  latest_spelling_last_reviewed_at timestamptz;
  latest_spelling_last_grade text;
begin
  if src_uid is null then
    raise exception '请先登录';
  end if;

  select u.id
  into dest_uid
  from auth.users u
  where lower(u.email::text) = lower(trim(target_email))
  limit 1;

  if dest_uid is null then
    raise exception '该邮箱不是已注册用户';
  end if;

  if dest_uid = src_uid then
    raise exception '不能共享给自己';
  end if;

  created_children := 0;
  inserted_sentences := 0;
  upserted_words := 0;
  inserted_logs := 0;

  for src_child in
    select * from children where owner = src_uid order by created_at
  loop
    select c.id
    into target_child_id
    from children c
    where c.owner = dest_uid and c.name = src_child.name
    order by c.created_at
    limit 1;

    if not found then
      insert into children(owner, name)
      values (dest_uid, src_child.name)
      returning id into target_child_id;
      created_children := created_children + 1;
    end if;

    for src_sentence in
      select * from sentences where child_id = src_child.id order by created_at
    loop
      if not exists (
        select 1 from sentences s
        where s.child_id = target_child_id and s.text = src_sentence.text
      ) then
        insert into sentences(child_id, text, created_at)
        values (target_child_id, src_sentence.text, src_sentence.created_at);
        inserted_sentences := inserted_sentences + 1;
      end if;
    end loop;

    for src_word in
      select * from words where child_id = src_child.id order by first_learned_at
    loop
      mapped_sentence_ids := coalesce((
        select array_agg(distinct target_sentence.id)
        from unnest(coalesce(src_word.sentence_ids, '{}'::uuid[])) as sid
        join sentences source_sentence on source_sentence.id = sid
        join lateral (
          select s2.id
          from sentences s2
          where s2.child_id = target_child_id and s2.text = source_sentence.text
          order by s2.created_at
          limit 1
        ) as target_sentence on true
      ), '{}'::uuid[]);

      select *
      into existing_word
      from words w
      where w.child_id = target_child_id and w.text = src_word.text
      limit 1;

      if not found then
        insert into words(
          child_id, text, lang, sentence_ids, first_learned_at, example_sentence, needs_spelling,
          interval, ef, repetitions, due_date, last_grade, last_reviewed_at, pending_retry_count,
          volatility_rate,
          spelling_interval, spelling_ef, spelling_repetitions, spelling_due_date,
          spelling_last_grade, spelling_last_reviewed_at, spelling_pending_retry_count
        )
        values (
          target_child_id, src_word.text, src_word.lang, mapped_sentence_ids, src_word.first_learned_at,
          src_word.example_sentence, src_word.needs_spelling,
          src_word.interval, src_word.ef, src_word.repetitions, src_word.due_date,
          src_word.last_grade, src_word.last_reviewed_at, src_word.pending_retry_count,
          src_word.volatility_rate,
          src_word.spelling_interval, src_word.spelling_ef, src_word.spelling_repetitions,
          src_word.spelling_due_date, src_word.spelling_last_grade, src_word.spelling_last_reviewed_at,
          src_word.spelling_pending_retry_count
        )
        returning id into target_word_id;
      else
        latest_last_reviewed_at :=
          case
            when existing_word.last_reviewed_at is null then src_word.last_reviewed_at
            when src_word.last_reviewed_at is null then existing_word.last_reviewed_at
            when existing_word.last_reviewed_at >= src_word.last_reviewed_at then existing_word.last_reviewed_at
            else src_word.last_reviewed_at
          end;
        latest_last_grade :=
          case
            when latest_last_reviewed_at is not distinct from existing_word.last_reviewed_at then existing_word.last_grade
            else src_word.last_grade
          end;

        latest_spelling_last_reviewed_at :=
          case
            when existing_word.spelling_last_reviewed_at is null then src_word.spelling_last_reviewed_at
            when src_word.spelling_last_reviewed_at is null then existing_word.spelling_last_reviewed_at
            when existing_word.spelling_last_reviewed_at >= src_word.spelling_last_reviewed_at then existing_word.spelling_last_reviewed_at
            else src_word.spelling_last_reviewed_at
          end;
        latest_spelling_last_grade :=
          case
            when latest_spelling_last_reviewed_at is not distinct from existing_word.spelling_last_reviewed_at then existing_word.spelling_last_grade
            else src_word.spelling_last_grade
          end;

        update words
        set
          sentence_ids = (
            select array_agg(distinct sid)
            from unnest(coalesce(existing_word.sentence_ids, '{}'::uuid[]) || mapped_sentence_ids) as sid
          ),
          first_learned_at = least(existing_word.first_learned_at, src_word.first_learned_at),
          example_sentence = coalesce(existing_word.example_sentence, src_word.example_sentence),
          needs_spelling = existing_word.needs_spelling or src_word.needs_spelling,
          interval = greatest(existing_word.interval, src_word.interval),
          ef = greatest(existing_word.ef, src_word.ef),
          repetitions = greatest(existing_word.repetitions, src_word.repetitions),
          due_date = least(existing_word.due_date, src_word.due_date),
          last_grade = latest_last_grade,
          last_reviewed_at = latest_last_reviewed_at,
          pending_retry_count = greatest(existing_word.pending_retry_count, src_word.pending_retry_count),
          volatility_rate = greatest(existing_word.volatility_rate, src_word.volatility_rate),
          spelling_interval = greatest(existing_word.spelling_interval, src_word.spelling_interval),
          spelling_ef = greatest(existing_word.spelling_ef, src_word.spelling_ef),
          spelling_repetitions = greatest(existing_word.spelling_repetitions, src_word.spelling_repetitions),
          spelling_due_date = least(existing_word.spelling_due_date, src_word.spelling_due_date),
          spelling_last_grade = latest_spelling_last_grade,
          spelling_last_reviewed_at = latest_spelling_last_reviewed_at,
          spelling_pending_retry_count = greatest(existing_word.spelling_pending_retry_count, src_word.spelling_pending_retry_count)
        where id = existing_word.id;

        target_word_id := existing_word.id;
      end if;

      upserted_words := upserted_words + 1;

      for src_log in
        select * from review_logs
        where child_id = src_child.id and word_id = src_word.id
        order by reviewed_at
      loop
        if not exists (
          select 1 from review_logs rl
          where rl.child_id = target_child_id
            and rl.word_id = target_word_id
            and rl.grade = src_log.grade
            and rl.reviewed_at = src_log.reviewed_at
        ) then
          insert into review_logs(child_id, word_id, grade, reviewed_at)
          values (target_child_id, target_word_id, src_log.grade, src_log.reviewed_at);
          inserted_logs := inserted_logs + 1;
        end if;
      end loop;
    end loop;
  end loop;

  return next;
end;
$$;

grant execute on function is_admin() to authenticated;
grant execute on function admin_user_stats() to authenticated;
grant execute on function admin_words() to authenticated;
grant execute on function admin_feedback() to authenticated;
grant execute on function share_data_to_email(text) to authenticated;
