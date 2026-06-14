# 英语记忆小助手

帮助家长陪 5 岁孩子学习英语：录入每日新句子 → 自动拆词 → 基于「儿童版 SM-2」间隔重复算法安排复习。

## 功能模块
1. **录入新内容**：输入英文句子，自动拆成单词并开始跟踪记忆。
2. **今日复习清单**：按记忆曲线（儿童版 SM-2）列出到期需复习的单词，限制每日数量。
3. **复习反馈**：对每个词打三档（熟练 / 略陌生 / 彻底陌生），自动更新复习计划。

## 技术栈
- 前端：React + TypeScript + Vite
- 后台（多设备同步）：Supabase（Postgres + Auth + RLS 行级安全多用户隔离）
- 当前 P0：默认使用浏览器本地存储，可立即试用；接入 Supabase 后切换为云端同步。

## 本地运行
```bash
npm install
npm run dev
```

## 核心目录
- `src/lib/tokenizer.ts` — 拆词引擎
- `src/lib/sm2.ts` — 儿童版 SM-2 间隔重复算法
- `src/lib/wordService.ts` — 业务服务层（录入 / 复习清单 / 反馈）
- `src/lib/repo.ts` — 数据仓储接口（本地 / Supabase 可切换）
- `src/components/` — 三大功能模块界面
- `supabase/schema.sql` — 数据库结构 + RLS 多用户策略

## 接入 Supabase（多设备同步，下一阶段）
1. 在 supabase.com 新建项目。
2. 在 SQL Editor 执行 `supabase/schema.sql`。
3. 复制 `.env.example` 为 `.env.local`，填入项目 URL 和 anon key。
4. 实现 `SupabaseRepo` 并在 `src/lib/db.ts` 中切换（P1 计划）。

## 儿童版 SM-2 说明
评分三档；首答次日复习、第二次 2-3 天、之后按熟练度因子增长，间隔封顶约 3 周以保持高频。彻底陌生则归零、次日重学。参数集中在 `src/lib/sm2.ts` 的 `SM2_CONFIG`，可按孩子情况调优。
