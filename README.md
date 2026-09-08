# JNL学习小助手

帮助家长陪孩子学习中英文：每日录入新句子 → 自动拆词 / 拆字 → 基于「儿童版 SM-2」间隔重复算法安排读、拼、写复习，并支持中文读麦克风发音练习、多设备云端同步、AI 例句提示、配置同步与数据共享。

## 功能模块
1. **录入新内容**：输入英文句子（按词拆分）或中文（按单字拆分），先预览并可删除不需要保留的词 / 字，再写入记忆库；可选学习日期，默认今天。
2. **今日复习**：按记忆曲线列出到期内容，分为英文读、英文拼、中文读、中文写四个队列；每日最大个数可配置，超出上限时按配额选词（从未复习的新词保底 10%、逾期超 3 天 40%、不稳定 30%、普通 20%），评分即写库，重进可继续。
3. **复习反馈**：四档评分（秒读 / 熟练 / 略陌生 / 彻底陌生）自动更新复习计划；彻底陌生会当天补做两遍（第一遍约在 10 个词之后，其余在队列末尾）。每次进入启用倒计时的复习模块时，需首次手动点击“继续倒计时”或按空格，后续单词才会自动倒计时；超时会自动判为彻底陌生，三个单词及以上的词组倒计时翻倍。
4. **中文读发音练习**：中文读改为语音练习模式。首次点击麦克风只会触发浏览器麦克风权限，请求成功后当前中文读会话会复用同一条音频流；录音不足 250ms 会在浏览器端直接要求重试，合格录音会解码为单声道 PCM WAV 后提交，也会在说话后静音约 800ms 或最晚 6 秒时自动停止。评估先转写，再由支持原始音频输入的模型结合目标文本作带置信度的判断：只有高置信度的明确读错才会判为「彻底陌生」，听不清或低置信度结果不会评分。首次读对自动判为「熟练」，保存评分后播放满约 1.2 秒反馈再进入下一个；明确读错保存后停留当前词并锁定手动评分，但仍可切换下一词、重试发音和「听正确读音」。重试只更新提示，不会再次改分。单字的任一常见现代普通话读音都可通过，并会自动准备 3 个包含目标字的辅助词供逐个播放跟读；词组 / 句子只播放完整标准读音。中文读关闭倒计时，其他复习模式保持原有规则。
5. **AI 例句提示**：复习时可「看例句提示」调用 AI 生成儿童例句和临时配图，例句生成后落库复用，也可「换一句」重新生成。
6. **总览 / 统计**：查看已录入词 / 字、读熟练度、拼写熟练度、熟练度波动率、连续学习天数、今日到期和近 7 天趋势。
7. **配置与数据共享**：配置复习倒计时、四类复习每日上限，并可云端保存；也可把当前账户学习数据推送共享给另一个已注册邮箱。
8. **版本更新与建议**：录入页底部展示版本日志，并可提交使用建议（写入独立 feedback 表）。
9. **管理员页面**：仅管理员邮箱可见，汇总各用户登录时间、录入明细与建议。

## 技术栈
- 前端：React + TypeScript + Vite（纯静态，PWA 方向）
- 后端：Supabase（Postgres + Auth + RLS 行级安全多用户隔离）
- AI / 语音：Vercel Serverless 代理调用通义千问（qwen-turbo）、Qwen-Image-2.0、Qwen-Audio-3.0-ASR-Flash、Qwen3.5-Omni-Plus 和 qwen3-tts-flash
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
- `api/generate-sentence.ts` / `api/generate-image.ts` / `api/assess-pronunciation.ts` / `api/generate-pronunciation-examples.ts` / `api/synthesize-pronunciation.ts` — Vercel Serverless：服务端代理通义千问文本、图片、发音评估、辅助词和标准读音生成（共读 `QWEN_API_KEY`；发音评估使用同步 `qwen-audio-3.0-asr-flash` 转写，并由固定的 `qwen3.5-omni-plus` 通过 OpenAI 兼容 Chat Completions 流式协议直接读取原始录音、返回 JSON Object，再由服务端严格校验状态与置信度；TTS 固定为 `qwen3-tts-flash`，音色默认 `Cherry`）
- `api/pronunciationSecurity.ts` — 校验 Supabase Session Bearer Token，并通过 Supabase RPC 实施跨 Vercel 实例的用户/IP 频率与并发限制
- `supabase/schema.sql` — 数据库结构 + RLS 多用户策略 + 管理员 / 数据共享 / 语音限流 RPC（幂等，可重复执行）

## 接入 Supabase（多设备同步）
1. 在 supabase.com 新建项目。
2. 在 SQL Editor 执行 `supabase/schema.sql`（升级后需重跑，幂等不丢数据），创建 `children / sentences / words / review_logs / feedback / user_settings`、语音请求限流表，以及管理员、数据共享、语音限流 RPC。已上线旧库必须先重跑 schema，再部署新版 Serverless 函数；否则发音接口会按设计关闭并返回 503。语音限流 RPC 只授予 `service_role`，`public / anon / authenticated` 均无执行权限。
3. 复制 `.env.example` 为 `.env.local`，填入 `VITE_SUPABASE_URL`、`VITE_SUPABASE_ANON_KEY`，并只在服务端环境配置 `SUPABASE_SERVICE_ROLE_KEY` 和 `QWEN_API_KEY`（两者都绝不能加 `VITE_` 前缀）。浏览器 bearer token 只用于向 Supabase Auth 验证身份；验证成功后，Serverless 才会用 service-role key 和已验证的用户 ID 调用限流 RPC。缺少 service-role key 时发音接口会失败关闭并返回 503。
4. 如需覆盖 ASR 模型或 TTS 音色，可选填 `QWEN_PRONUNCIATION_MODEL`、`QWEN_TTS_VOICE`。直接音频判断模型固定为 `qwen3.5-omni-plus`，TTS 模型固定为 `qwen3-tts-flash`，避免部署配置与安全策略漂移。`PRONUNCIATION_RATE_LIMIT_SECRET` 可单独设置 IP 指纹密钥；`PRONUNCIATION_SECURITY_TIMEOUT_MS` 和 `PRONUNCIATION_UPSTREAM_TIMEOUT_MS` 可调整服务端超时。每类操作的用户/IP频率、并发、30 秒租约以及 synthesis 的账户级 `dashscope-tts / qwen3-tts-flash` 滚动限制（3 次/秒、180 次/分钟）均硬编码在 SQL，调用方不能覆盖。上游 deadline 按 RPC 返回的实际剩余租约计算并预留安全余量。
5. 配好 env 后 `db.ts` 自动切换为云端同步。

## 部署
- 当前使用 Vercel（framework=vite，output=dist，SPA rewrite，见 `vercel.json`），免费免备案、立即可用。
- 在 Vercel 设置上述环境变量后 Deploy，并把部署网址填入 Supabase Authentication → Site URL。
- 阿里云 OSS + 自有域名（jnlstudy.com）方案见 `DEPLOY.md`。

## 儿童版 SM-2 说明
评分四档：秒读、熟练、略陌生、彻底陌生。新词次日首复习；秒读让读熟练度 +1，熟练 +0.5，略陌生 -1（最低 0），彻底陌生清零并当天追加到队尾补做。读熟练度达到 `repetitions >= 4` 后自动进入英文拼 / 中文写队列；拼写 / 会写使用独立的 `spelling_*` 进度，`spellingRepetitions >= 5` 视为已熟悉拼写 / 会写。中英文共用同一套算法，仅按 `lang` 过滤；间隔封顶约 21 天，参数集中在 `src/lib/sm2.ts`。
