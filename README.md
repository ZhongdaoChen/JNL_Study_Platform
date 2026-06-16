# JNL学习小助手

帮助家长陪孩子学习中英文：每日录入新句子 → 自动拆词 → 基于「儿童版 SM-2」间隔重复算法安排复习，并支持多设备云端同步与 AI 例句提示。

## 功能模块
1. **录入新内容**：输入英文句子（按词拆分）或中文（按单字拆分），自动建立记忆跟踪；可选学习日期，默认今天。
2. **今日复习**：按记忆曲线（儿童版 SM-2）列出全部到期的词，英文 / 中文分标签；不设每日上限，评分即写库，重进可继续。
3. **复习反馈**：对每个词打三档（熟练 / 略陌生 / 彻底陌生），自动更新复习计划；可「看例句提示」用 AI 生成儿童例句，「换一句」重新生成。
4. **总览 / 统计**：查看已录入词、掌握进度、打卡天数与 7 天趋势。
5. **版本更新与建议**：录入页底部展示版本日志，并可提交使用建议（写入独立 feedback 表）。
6. **管理员页面**：仅管理员邮箱可见，汇总各用户登录时间、录入明细与建议。

## 技术栈
- 前端：React + TypeScript + Vite（纯静态，PWA 方向）
- 后端：Supabase（Postgres + Auth + RLS 行级安全多用户隔离）
- AI 例句：Vercel Serverless 代理调用通义千问（qwen-turbo）
- 存储模式：配置了 Supabase env 时走云端同步，否则自动回退到浏览器本地存储，可立即试用。

## 本地运行
```bash
npm install
npm run dev
```

## 核心目录
- `src/lib/tokenizer.ts` — 拆词引擎（英文按词 / 中文按单字）
- `src/lib/sm2.ts` — 儿童版 SM-2 间隔重复算法（参数集中在 `SM2_CONFIG`）
- `src/lib/wordService.ts` — 业务服务层（录入 / 复习清单 / 反馈）
- `src/lib/statsService.ts` — 学习统计（打卡 / 掌握数 / 7 天趋势）
- `src/lib/ai.ts` — AI 例句生成（调用 `/api/generate-sentence`）
- `src/lib/repo.ts` / `localRepo.ts` / `supabaseRepo.ts` / `db.ts` — 仓储接口与本地 / 云端可切换实现
- `src/lib/admin.ts` / `changelog.ts` — 管理员 RPC 与版本日志
- `src/components/` — 各功能模块界面（AuthGate / Workspace / 录入 / 复习 / 总览 / 统计 / 管理员）
- `api/generate-sentence.ts` — Vercel Serverless：服务端代理调通义千问（读 `QWEN_API_KEY`）
- `supabase/schema.sql` — 数据库结构 + RLS 多用户策略（幂等，可重复执行）

## 接入 Supabase（多设备同步）
1. 在 supabase.com 新建项目。
2. 在 SQL Editor 执行 `supabase/schema.sql`（升级后需重跑，幂等不丢数据）。
3. 复制 `.env.example` 为 `.env.local`，填入 `VITE_SUPABASE_URL`、`VITE_SUPABASE_ANON_KEY`；AI 例句另需服务端 `QWEN_API_KEY`（不要加 `VITE_` 前缀）。
4. 配好 env 后 `db.ts` 自动切换为云端同步。

## 部署
- 当前使用 Vercel（framework=vite，output=dist，SPA rewrite，见 `vercel.json`），免费免备案、立即可用。
- 在 Vercel 设置上述环境变量后 Deploy，并把部署网址填入 Supabase Authentication → Site URL。
- 阿里云 OSS + 自有域名（jnlstudy.com）方案见 `DEPLOY.md`。

## 儿童版 SM-2 说明
评分三档；新词次日首复习、第二次 2-3 天、之后按熟练度因子（ef）增长，间隔封顶约 21 天以保持高频；彻底陌生则归零、次日重学。「已掌握」口径为 `repetitions >= 3`。中英文共用同一套算法，仅按 `lang` 过滤。参数集中在 `src/lib/sm2.ts` 的 `SM2_CONFIG`，可按孩子情况调优。
