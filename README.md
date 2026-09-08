# JNL学习小助手

帮助家长陪孩子学习中英文：每日录入新句子 → 自动拆词 / 拆字 → 基于「儿童版 SM-2」间隔重复算法安排读、拼、写复习，并支持中文读麦克风发音练习、多设备云端同步、AI 例句提示、配置同步与数据共享。

## 功能模块
1. **录入新内容**：输入英文句子（按词拆分）或中文（按单字拆分），先预览并可删除不需要保留的词 / 字，再写入记忆库；可选学习日期，默认今天。
2. **今日复习**：按记忆曲线列出到期内容，分为英文读、英文拼、中文读、中文写四个队列；每日最大个数可配置，超出上限时按配额选词（从未复习的新词保底 10%、逾期超 3 天 40%、不稳定 30%、普通 20%），评分即写库，重进可继续。
3. **复习反馈**：四档评分（秒读 / 熟练 / 略陌生 / 彻底陌生）自动更新复习计划；彻底陌生会当天补做两遍（第一遍约在 10 个词之后，其余在队列末尾）。每次进入启用倒计时的复习模块时，需首次手动点击“继续倒计时”或按空格，后续单词才会自动倒计时；超时会自动判为彻底陌生，三个单词及以上的词组倒计时翻倍。
4. **中文读发音练习**：中文读改为语音练习模式。首次点击麦克风只会触发浏览器麦克风权限，请求成功后当前中文读会话会复用同一条音频流；录音可手动停止，也会在说话后静音约 800ms 或最晚 6 秒时自动提交一次。首次读对自动判为「熟练」，播放“读对了”庆祝动画并约 1.2 秒后进入下一个；首次读错自动判为「彻底陌生」，停留当前词并提供重试和「听正确读音」。重试只更新提示，不会再次改分。单字会自动准备 3 个包含目标字的辅助词并支持逐个播放跟读；词组 / 句子只播放完整标准读音。中文读关闭倒计时，其他复习模式保持原有规则。
5. **AI 例句提示**：复习时可「看例句提示」调用 AI 生成儿童例句和临时配图，例句生成后落库复用，也可「换一句」重新生成。
6. **总览 / 统计**：查看已录入词 / 字、读熟练度、拼写熟练度、熟练度波动率、连续学习天数、今日到期和近 7 天趋势。
7. **配置与数据共享**：配置复习倒计时、四类复习每日上限，并可云端保存；也可把当前账户学习数据推送共享给另一个已注册邮箱。
8. **版本更新与建议**：录入页底部展示版本日志，并可提交使用建议（写入独立 feedback 表）。
9. **管理员页面**：仅管理员邮箱可见，汇总各用户登录时间、录入明细与建议。

## 技术栈
- 前端：React + TypeScript + Vite（纯静态，PWA 方向）
- 后端：Supabase（Postgres + Auth + RLS 行级安全多用户隔离）
- AI / 语音：Vercel Serverless 代理调用通义千问（qwen-turbo）、Qwen-Image-2.0、Qwen-Audio-3.0-ASR-Flash、Qwen3.8-Flash 和 qwen3-tts-flash
- 存储模式：配置了 Supabase env 时走云端同步，否则自动回退到浏览器本地存储，可立即试用。

## 本地运行
```bash
npm install
npm run dev
# 需要调试 /api 下的 AI / 发音接口时，请改用 vercel dev
```

## 核心目录
- `src/lib/tokenizer.ts` — 拆词引擎（英文按词 / 中文按单字）
- `src/lib/sm2.ts` — 儿童版 SM-2 间隔重复算法（读 / 拼写双轨参数集中在 `SM2_CONFIG`）
- `src/lib/wordService.ts` — 业务服务层（录入 / 到期队列 / 复习反馈 / 当天补做）
- `src/lib/reviewQueue.ts` — 复习会话队列的当天补做排队规则（首遍补做延后约 10 词，其余在队尾）
- `src/lib/statsService.ts` — 学习统计（打卡 / 熟悉读 / 到期预测 / 7 天趋势 / 波动率）
- `src/lib/ai.ts` — AI 例句和临时配图生成（调用 `/api/generate-sentence`、`/api/generate-image`）
- `src/lib/pronunciationApi.ts` / `pronunciationRules.ts` / `speechRecorder.ts` — 中文读发音评估、辅助词校验 / 播放顺序、麦克风录音与静音/超时自动停止
- `src/components/PronunciationPractice.tsx` / `src/components/pronunciationSession.ts` — 中文读麦克风交互、首次发音评分锁、标准读音顺序播放与庆祝动画
- `src/lib/repo.ts` / `localRepo.ts` / `supabaseRepo.ts` / `db.ts` — 仓储接口与本地 / 云端可切换实现
- `src/lib/userSettings.ts` / `dataShare.ts` — 用户配置云端同步与账户间数据共享
- `src/lib/admin.ts` / `changelog.ts` — 管理员 RPC 与版本日志
- `src/components/` — 各功能模块界面（AuthGate / Workspace / 录入 / 复习 / 中文发音练习 / 总览 / 统计 / 配置 / 管理员）
- `api/generate-sentence.ts` / `api/generate-image.ts` / `api/assess-pronunciation.ts` / `api/generate-pronunciation-examples.ts` / `api/synthesize-pronunciation.ts` — Vercel Serverless：服务端代理通义千问文本、图片、发音评估、辅助词和标准读音生成（共读 `QWEN_API_KEY`；发音评估默认使用同步 `qwen-audio-3.0-asr-flash`，单字读音再由 `qwen3.8-flash` 严格 JSON Schema 判定，TTS 默认 `qwen3-tts-flash` + `Cherry`）
- `api/pronunciationSecurity.ts` — 校验 Supabase Session Bearer Token，并通过 Supabase RPC 实施跨 Vercel 实例的用户/IP 频率与并发限制
- `supabase/schema.sql` — 数据库结构 + RLS 多用户策略 + 管理员 / 数据共享 / 语音限流 RPC（幂等，可重复执行）

## 接入 Supabase（多设备同步）
1. 在 supabase.com 新建项目。
2. 在 SQL Editor 执行 `supabase/schema.sql`（升级后需重跑，幂等不丢数据），创建 `children / sentences / words / review_logs / feedback / user_settings`、语音请求限流表，以及管理员、数据共享、语音限流 RPC。已上线旧库也必须在部署新版 Serverless 函数前重跑一次，让 `words.pronunciation_examples`、限流表的 `resource_key / model_key` 字段和新版 RPC 签名补齐；否则发音接口会按设计关闭并返回 503。
3. 复制 `.env.example` 为 `.env.local`，填入 `VITE_SUPABASE_URL`、`VITE_SUPABASE_ANON_KEY`；AI 例句、配图和中文读发音接口共用服务端 `QWEN_API_KEY`（不要加 `VITE_` 前缀）。发音接口要求有效的 Supabase 登录会话；浏览器本地存储模式会明确提示语音云服务不可用，而不会匿名调用付费接口。
4. 如需覆盖默认模型 / 音色，可选填 `QWEN_PRONUNCIATION_MODEL`、`QWEN_PRONUNCIATION_JUDGE_MODEL`、`QWEN_TTS_MODEL`、`QWEN_TTS_VOICE`。可选的 `PRONUNCIATION_*` 变量用于调整每用户/IP的每分钟、并发限制及服务端超时；超时会自动限制在 30 秒租约以内。限流状态存储在 Supabase，因此多台 Vercel 实例共享；默认 `qwen3-tts-flash` 还会按显式资源/模型键执行账户全局滚动限制（3 次/秒、180 次/分钟），不能通过切换用户或 IP 绕过。
5. 配好 env 后 `db.ts` 自动切换为云端同步。

## 部署
- 当前使用 Vercel（framework=vite，output=dist，SPA rewrite，见 `vercel.json`），免费免备案、立即可用。
- 在 Vercel 设置上述环境变量后 Deploy，并把部署网址填入 Supabase Authentication → Site URL。
- 阿里云 OSS + 自有域名（jnlstudy.com）方案见 `DEPLOY.md`。

## 儿童版 SM-2 说明
评分四档：秒读、熟练、略陌生、彻底陌生。新词次日首复习；秒读让读熟练度 +1，熟练 +0.5，略陌生 -1（最低 0），彻底陌生清零并当天追加到队尾补做。读熟练度达到 `repetitions >= 4` 后自动进入英文拼 / 中文写队列；拼写 / 会写使用独立的 `spelling_*` 进度，`spellingRepetitions >= 5` 视为已熟悉拼写 / 会写。中英文共用同一套算法，仅按 `lang` 过滤；间隔封顶约 21 天，参数集中在 `src/lib/sm2.ts`。
