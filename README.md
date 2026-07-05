# JNL学习小助手

帮助家长陪孩子学习中英文：每日录入新句子 → 自动拆词 / 拆字 → 基于「儿童版 SM-2」间隔重复算法安排读、拼、写复习，并支持多设备云端同步、AI 例句提示、配置同步与数据共享。

## 功能模块
1. **录入新内容**：输入英文句子（按词拆分）或中文（按单字拆分），先预览并可删除不需要保留的词 / 字，再写入记忆库；可选学习日期，默认今天。
2. **今日复习**：按记忆曲线列出到期内容，分为英文读、英文拼、中文读、中文写四个队列；每日最大个数可配置，英文读超出上限时优先选波动率高的到期词，评分即写库，重进可继续。
3. **复习反馈**：四档评分（秒读 / 熟练 / 略陌生 / 彻底陌生）自动更新复习计划；彻底陌生会当天追加到队尾补做，倒计时超时会自动判为彻底陌生。
4. **AI 例句提示**：复习时可「看例句提示」调用 AI 生成儿童例句和临时配图，例句生成后落库复用，也可「换一句」重新生成。
5. **总览 / 统计**：查看已录入词 / 字、读熟练度、拼写熟练度、熟练度波动率、连续学习天数、今日到期和近 7 天趋势。
6. **配置与数据共享**：配置复习倒计时、四类复习每日上限，并可云端保存；也可把当前账户学习数据推送共享给另一个已注册邮箱。
7. **版本更新与建议**：录入页底部展示版本日志，并可提交使用建议（写入独立 feedback 表）。
8. **管理员页面**：仅管理员邮箱可见，汇总各用户登录时间、录入明细与建议。

## 技术栈
- 前端：React + TypeScript + Vite（纯静态，PWA 方向）
- 后端：Supabase（Postgres + Auth + RLS 行级安全多用户隔离）
- AI 例句：Vercel Serverless 代理调用通义千问（qwen-turbo）和 Qwen-Image-2.0
- 存储模式：配置了 Supabase env 时走云端同步，否则自动回退到浏览器本地存储，可立即试用。

## 本地运行
```bash
npm install
npm run dev
```

## 核心目录
- `src/lib/tokenizer.ts` — 拆词引擎（英文按词 / 中文按单字）
- `src/lib/sm2.ts` — 儿童版 SM-2 间隔重复算法（读 / 拼写双轨参数集中在 `SM2_CONFIG`）
- `src/lib/wordService.ts` — 业务服务层（录入 / 到期队列 / 复习反馈 / 当天补做）
- `src/lib/statsService.ts` — 学习统计（打卡 / 熟悉读 / 到期预测 / 7 天趋势 / 波动率）
- `src/lib/ai.ts` — AI 例句和临时配图生成（调用 `/api/generate-sentence`、`/api/generate-image`）
- `src/lib/repo.ts` / `localRepo.ts` / `supabaseRepo.ts` / `db.ts` — 仓储接口与本地 / 云端可切换实现
- `src/lib/userSettings.ts` / `dataShare.ts` — 用户配置云端同步与账户间数据共享
- `src/lib/admin.ts` / `changelog.ts` — 管理员 RPC 与版本日志
- `src/components/` — 各功能模块界面（AuthGate / Workspace / 录入 / 复习 / 总览 / 统计 / 配置 / 管理员）
- `api/generate-sentence.ts` / `api/generate-image.ts` — Vercel Serverless：服务端代理调通义千问和 Qwen-Image-2.0（读 `QWEN_API_KEY`）
- `supabase/schema.sql` — 数据库结构 + RLS 多用户策略 + 管理员 / 数据共享 RPC（幂等，可重复执行）

## 接入 Supabase（多设备同步）
1. 在 supabase.com 新建项目。
2. 在 SQL Editor 执行 `supabase/schema.sql`（升级后需重跑，幂等不丢数据），创建 `children / sentences / words / review_logs / feedback / user_settings` 以及管理员、数据共享 RPC。
3. 复制 `.env.example` 为 `.env.local`，填入 `VITE_SUPABASE_URL`、`VITE_SUPABASE_ANON_KEY`；AI 例句和配图另需服务端 `QWEN_API_KEY`（不要加 `VITE_` 前缀）。
4. 配好 env 后 `db.ts` 自动切换为云端同步。

## 部署
- 当前使用 Vercel（framework=vite，output=dist，SPA rewrite，见 `vercel.json`），免费免备案、立即可用。
- 在 Vercel 设置上述环境变量后 Deploy，并把部署网址填入 Supabase Authentication → Site URL。
- 阿里云 OSS + 自有域名（jnlstudy.com）方案见 `DEPLOY.md`。

## 儿童版 SM-2 说明
评分四档：秒读、熟练、略陌生、彻底陌生。新词次日首复习；秒读让读熟练度 +1，熟练 +0.5，略陌生 -1（最低 0），彻底陌生清零并当天追加到队尾补做。读熟练度达到 `repetitions >= 4` 后自动进入英文拼 / 中文写队列；拼写 / 会写使用独立的 `spelling_*` 进度，`spellingRepetitions >= 5` 视为已熟悉拼写 / 会写。中英文共用同一套算法，仅按 `lang` 过滤；间隔封顶约 21 天，参数集中在 `src/lib/sm2.ts`。
