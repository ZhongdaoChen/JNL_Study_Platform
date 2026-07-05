# 项目状态与上下文存档（PROJECT_STATUS）

> 本文件用于让新的 Copilot 会话快速恢复上下文。记录项目目标、架构、部署、进度与待办。
> 最后更新：2026-06-22

---

## 1. 项目目标

一个帮助家长陪 **5 岁女儿** 学习中英文的应用「**JNL学习小助手**」。
- 家长每天录入新学的英文句子或中文句子 → 自动拆成英文单词 / 中文单字 → 跟踪每个词 / 字的记忆
- 基于「儿童版 SM-2」间隔重复算法，安排每天该复习、拼写或会写的内容
- 复习时家长对每个词 / 字打四档（秒读 / 熟练 / 略陌生 / 彻底陌生），自动更新复习计划
- 未来可能开放给其他用户使用（已按多用户架构设计）

## 2. 已确认的产品决策

- 形态：**网页应用（PWA 方向）**，React + TypeScript + Vite
- 操作者：**家长为主**，孩子在旁跟读（界面偏家长操作）
- 发音：暂不做（仅文字 + 记忆跟踪 + AI 例句）
- 跟踪粒度：英文以**单词**为主，中文以**单字**为主，句子作为语境保留
- 数据：**多设备同步**，需账号；用 Supabase；无 Supabase env 时自动回退浏览器本地存储
- 算法：**儿童版 SM-2**（四档评分、读 / 拼写双轨、首答次日、间隔上限约 21 天）
- 复习：英文读 / 英文拼 / 中文读 / 中文写四个队列；每日上限可配置，0 表示不限；英文读到期量超过上限时优先选波动率高的词；进度天然持久化（评分即写库，重进可继续）
- 配置：复习倒计时和四类每日上限可本地保存，云端模式可写入 `user_settings` 跨设备同步
- 账户协作：配置页可把当前账户学习数据推送共享给另一个已注册邮箱，目标账户取并集去重

## 3. 技术架构

```
前端 (React + TS + Vite, 纯静态)
  ├─ 组件: AuthGate(登录门) → Workspace(主体)
  │        Workspace 标签: 录入/复习/总览/统计/配置 (+ 管理员，仅管理员邮箱可见)
  │        录入页底部: Changelog(版本更新 + 用户建议输入框)
  │        复习子标签: 英文读 / 英文拼 / 中文读 / 中文写
  │        总览子标签: 英文 / 中文，并支持熟悉度筛选与批量删除
  └─ 逻辑层 src/lib/
       tokenizer.ts   拆词: tokenize(英文按词) / tokenizeZh(中文按单字) / tokenizeByLang
       sm2.ts         儿童版 SM-2 算法 (四档评分, 读/拼写双轨, 参数集中在 SM2_CONFIG)
       date.ts        日期工具(YYYY-MM-DD)
       wordService.ts 业务: addLearning(lang) / getDueReviews(lang, spellingOnly, maxCount) / submitReview
       statsService.ts 统计: 打卡/熟悉读/今日到期/明日预测/7天趋势/波动率
       ai.ts          调用 /api/generate-sentence 生成例句(按 lang)
       userSettings.ts 云端用户配置(countdownSec + dailyLimits)
       dataShare.ts   调用 share_data_to_email RPC 做账户间数据共享
       admin.ts       管理员 RPC: getAdminUserStats/Words/Feedback + ADMIN_EMAIL
       changelog.ts   版本日志数据(数组, 顶部加新版本)
       repo.ts        仓储接口(抽象)
       localRepo.ts   本地存储实现(localStorage)
       supabaseRepo.ts Supabase 实现
       supabase.ts    Supabase 客户端(读 env)
       db.ts          仓储单例: 有 env 密钥→云端, 否则→本地
  api/generate-sentence.ts  Vercel Serverless: 服务端代理调通义千问(读 QWEN_API_KEY)
            │ HTTPS
后端 Supabase (Postgres + Auth + RLS 行级安全多用户隔离)
```

### 仓储可切换设计
- UI 只依赖 `Repo` 接口。
- `db.ts` 根据是否配置了 `VITE_SUPABASE_URL/ANON_KEY` 决定用 `SupabaseRepo`(云端) 还是 `LocalRepo`(本地)。

## 4. 数据库结构 (supabase/schema.sql)

6 张表，全部启用 RLS，按 `auth.uid()` 隔离（每个家长只看自己数据）：
- `children`(owner=auth.uid(), name, created_at)
- `sentences`(child_id, text, created_at)
- `words`(child_id, text, **lang('en'|'zh', 默认 en)**, sentence_ids[], first_learned_at, **example_sentence**, needs_spelling, interval, ef, repetitions, due_date, last_grade, last_reviewed_at, pending_retry_count, volatility_rate, **spelling_interval / spelling_ef / spelling_repetitions / spelling_due_date / spelling_last_grade / spelling_last_reviewed_at / spelling_pending_retry_count**, unique(child_id,text))
- `review_logs`(child_id, word_id, grade, reviewed_at)
- `feedback`(owner=auth.uid(), content, created_at) — 用户建议/需求，独立表，不挂在孩子下
- `user_settings`(owner=auth.uid(), countdown_sec, review_limit_en_read, review_limit_en_spell, review_limit_zh_read, review_limit_zh_write, updated_at) — 用户配置跨设备同步
- 辅助函数 `owns_child(cid)` 用于子表 RLS 策略。

**管理员函数（security definer，仅管理员邮箱 chenzhongdao0730@gmail.com 可取数据）：**
- `is_admin()` — 校验 `auth.jwt()->>'email'` 是否为管理员
- `admin_user_stats()` — 各用户邮箱/最后登录/注册/中英文录入数
- `admin_words()` — 各用户录入的单词/单字明细
- `admin_feedback()` — 所有用户提交的建议
- 这些函数绕过 RLS 跨用户读 auth.users；内部 is_admin() 校验，非管理员调用返回空。
- `share_data_to_email(target_email)` — 当前用户把孩子、句子、单词和复习记录复制/合并到另一个已注册邮箱；目标账户取并集去重，源账户不变。

> ⚠️ 部署/升级后必须在 Supabase SQL Editor **重跑** `supabase/schema.sql`（幂等安全，无 drop/delete/truncate，不丢数据）。否则线上中文录入、反馈、管理员页、配置同步或数据共享可能报错。

## 5. 儿童版 SM-2 规则 (src/lib/sm2.ts)

- 四档评分: instant(秒读/秒拼/秒写) / mastered(熟练) / fuzzy(略陌生) / forgotten(彻底陌生)
- 新词读进度初始: interval=1, ef=2.5, dueDate=learnedOn+1；拼写/会写独立进度初始 dueDate=今天，但只有读熟悉度达标后才进入拼写/会写队列
- instant: repetitions +1, ef+0.15；mastered: repetitions +0.5, ef+0.1
- fuzzy: repetitions -1（最低 0）, ef-0.1，并缩短间隔
- forgotten: repetitions 归零, ef-0.2；首次彻底陌生会把该词保留在今天并设置 pendingRetryCount=2，后续作为当天队尾补做；补做不增加熟练度，补完后推到明天
- 英文拼连续两次彻底陌生时会退回英文读阶段，读熟悉度回滚到阈值前，并重置拼写进度
- 间隔上限 21 天(MAX_INTERVAL), ef 下限 1.3
- 「已熟悉读」统计口径: repetitions >= 4；「已熟悉拼/写」口径: spellingRepetitions >= 5
- 中英文共用同一套算法，仅按 `lang` 和 `spellingOnly` 过滤

## 6. 仓库 / 代码托管

- GitHub: **git@github.com:ZhongdaoChen/JNL_Study_Platform.git** (SSH, 账号 ZhongdaoChen)
- 默认分支: `main`
- 本地路径: `/Users/chenpet/PeterChen/xiaorenwu`
- 提交方式: `git -c user.name="ZhongdaoChen" -c user.email="223556219+Copilot@users.noreply.github.com" commit ...`，带 Co-authored-by: Copilot 尾注
- 关键提交(新→旧):
  - `698cb8e` 读熟练度支持 0.5 增量(秒读 +1, 熟练 +0.5)
  - `40a59ad` 用户配置跨设备同步(user_settings)
  - `9c3e522` 录入新增两步拆词/拆字预览
  - `f36372e` 单词持久化熟练度波动率
  - `84ddba3` 学习统计拆分今日待复习中英文
  - `390cf56` 彻底陌生改为当天队尾补做两遍, 拼写按钮显示秒拼
  - `a07bfdc` 复习页新增秒读评分并调整加分逻辑
  - `73635ab` 配置页增加数据共享到账户功能
  - `339d020` 英文拼连续两次彻底陌生时退回英文读
  - `2d0590c` 总览页增加读写熟练度与筛选
  - `9000806` 管理员页面(仅管理员邮箱可见)
  - `41c1e44` 版本更新框末尾加用户建议反馈(feedback 表)
  - `e5b6ee9` 中文学习(按单字拆分, 复习/总览分中英标签)
  - `fb14afe` AI 例句生成(通义千问)
  - `27ca888` 复习修复+部署配置; `fdac49f` 初始提交
- 推送方式: 本地 `~/.ssh` 有 key, `ssh -T git@github.com` 认证为 ZhongdaoChen

## 7. Supabase 后台

- 项目 ref: **yuakftddvvwccnnckyyv**
- URL: **https://yuakftddvvwccnnckyyv.supabase.co**
- anon key: 存在本地 `.env.local`（未提交 git；anon 是公开密钥，安全靠 RLS）
- 待办/已办: 关闭邮箱验证(Authentication→Email→Confirm email 关闭); 登录后需把 Site URL 设为线上地址
- ⚠️ 不要把 service_role 密钥放进前端

## 8. 部署方案

### 目标
- 域名: **jnlstudy.com**（jnl.com 无法注册, 短.com 已被占）
- 想要 www.jnlstudy.com

### 阿里云 OSS 方案（最终方案, 见 DEPLOY.md）
- 纯前端→OSS 静态托管, Bucket 公共读, 开启静态页面(首页/404 都 index.html)
- 地域: 上海 (用户已建 bucket `jnlstudy-site` 在 oss-cn-shanghai)
- **卡点1**: OSS 默认域名 *.aliyuncs.com 访问 html 会被强制下载(阿里云反滥用), 必须绑自有域名才能渲染
- **卡点2**: 绑自有域名到大陆 OSS 必须先 **ICP 备案**(1–20 工作日)
- **备案前提**: OSS 不能生成备案服务码, 需另买「轻量应用服务器」或 ECS(包年包月≥3个月)取得备案服务码
- 域名实名认证≠备案, 两者都要

### Vercel 过渡方案（当前进行中, 立即可用、免费、免备案）
- 已加 `vercel.json`(framework=vite, output=dist, SPA rewrite)
- 用户在 Vercel 用**邮箱登录**, 正在绑定 GitHub 以导入仓库
- 部署步骤: Vercel→Add New Project→Import JNL_Study_Platform→设置环境变量→Deploy
- **必须设的环境变量**(否则用本地存储模式):
  - `VITE_SUPABASE_URL` = https://yuakftddvvwccnnckyyv.supabase.co
  - `VITE_SUPABASE_ANON_KEY` = (见 .env.local)
  - `QWEN_API_KEY` = (通义千问 Key, 见 .env.local; ⚠️ 仅服务端用, 不要加 VITE_ 前缀)
- 部署后: 把 Vercel 网址填到 Supabase Authentication → Site URL
- 免费额度对个人足够; 备案完成后可在 Vercel 绑定 jnlstudy.com(也免备案/免费 HTTPS)

## 9. 当前进度

### 已完成
- [x] P0 骨架: Vite+React+TS, 拆词, SM-2, 三模块 UI, 本地存储
- [x] P1: Supabase 客户端 + SupabaseRepo + 邮箱登录(AuthGate) + RLS schema
- [x] 功能: 单词删除(单个+批量多选), 录入可选学习日期(默认今天)
- [x] 拆词正则: 只存英文单词, 排除 6/10、纯数字、cat/dog 等
- [x] 学习统计看板(打卡/掌握进度/7天趋势)
- [x] 学习统计补充今日待复习中英文拆分、预测明日待复习、累计评分分布
- [x] 改名为「JNL学习小助手」
- [x] git 初始化并推送 GitHub
- [x] 修复复习计数错乱(refreshKey 导致重置)、去除每日上限、显示今日复习总数
- [x] 写好 DEPLOY.md(阿里云) 与 vercel.json
- [x] AI 例句: 复习时"看例句提示"调用通义千问(qwen-turbo)生成儿童例句, 落库复用, 「换一句」可重新生成
  - 服务端代理: `api/generate-sentence.ts`(Vercel Serverless, 读 `QWEN_API_KEY`), 前端 `src/lib/ai.ts`
  - Word 新增字段 `exampleSentence`; schema.sql 加 `example_sentence` 列(含旧库兼容 ALTER)
- [x] 中文学习: 可录入中文(按单字拆分), 与英文分开记录(Word.lang='en'|'zh')
  - 录入页加 英文/中文 切换; 复习、总览模块各加 英文/中文 子标签, 只显示对应语言内容
  - AI 例句按语言生成(中文字生成简单中文句子); schema.sql 加 `lang` 列(含旧库兼容 ALTER)
  - 复用同一套 SM-2/仓储/复习逻辑, 仅按 lang 过滤; 中文单字与英文单词字符集不重叠, 无冲突
- [x] 录入页底部「版本更新」框(Changelog), 数据在 src/lib/changelog.ts, 仅录入页显示
- [x] 版本更新框末尾「用户建议」输入框 → 写入独立 feedback 表(含 RLS)
- [x] 管理员页面(仅 chenzhongdao0730@gmail.com 登录可见):
  - 显示所有用户最后登录时间、各用户录入的单词/单字、所有用户提交的建议
  - 后端 security definer 函数跨用户汇总 + is_admin() 校验; 前端 AdminPanel + admin.ts
- [x] 复习页升级为英文读 / 英文拼 / 中文读 / 中文写四队列
  - 读熟悉度达到 4 后自动进入拼写/会写队列；拼写/会写使用独立 `spelling_*` 进度
  - 新增秒读/秒拼/秒写评分；彻底陌生当天追加到队尾补做两遍
  - 英文拼连续两次彻底陌生会退回英文读阶段
- [x] 配置页:
  - 可设置复习倒计时；倒计时归零自动判彻底陌生
  - 可分别设置英文读、英文拼、中文读、中文写每日最大个数
  - 云端模式下可提交配置到 `user_settings`，跨设备同步
- [x] 数据共享:
  - 配置页可把当前账户学习数据推送给另一个已注册邮箱
  - Supabase `share_data_to_email(target_email)` 做孩子/句子/单词/复习记录复制合并与去重
- [x] 录入流程改为两步：先拆词/拆字预览，可删除不需要保留的 token，再确认写入
- [x] 总览页新增熟悉度筛选、读/拼写熟练度百分比、熟练度波动率

### 待用户在后台操作（线上生效前必须做）
- [ ] ⚠️ Supabase SQL Editor **重跑 schema.sql**(幂等不丢数据) → 补 `lang/example_sentence/needs_spelling/spelling_*/*_pending_retry_count/volatility_rate` 列、建 `feedback/user_settings` 表、建 `admin_*` 与 `share_data_to_email` 函数
- [ ] ⚠️ Vercel 后台新增环境变量 `QWEN_API_KEY`(无 VITE_ 前缀, 否则 AI 例句报错)
- [ ] ⚠️ 建议轮换曾经明文发送过的 Qwen Key；不要把任何服务端密钥提交到仓库或前端环境变量

### 进行中 / 待办
- [ ] Vercel 部署(用户已邮箱登录, 待绑定 GitHub→导入→设环境变量→Deploy)
- [ ] Supabase: 关闭邮箱验证、设 Site URL
- [ ] 阿里云 ICP 备案(并行长期任务)
- [ ] App 内「删除孩子」按钮(目前误建的孩子只能去 SQL Editor 删 children 表)

### 后续可做(用户感兴趣的 backlog)
- [ ] 发音朗读(Web Speech API, 零成本)
- [ ] 奖励星星/激励机制
- [ ] 单词配图/卡片
- [ ] 复习例句高亮、同词多句轮换、错词本
- [ ] 数据导出/备份
- [ ] PWA 离线 + 添加到主屏幕(原 P3)
- [ ] 批量录入(一次多句)

## 10. 开发常用命令

```bash
cd /Users/chenpet/PeterChen/xiaorenwu
npm install
npm run dev        # 本地开发 (默认 5173, 之前用过 --port 5174 --host)
npm run build      # 生产构建到 dist/
npm run lint       # ESLint
npm run preview    # 预览生产包
git add -A && git commit -m "..." && git push   # 提交并自动触发 Vercel 部署
```

## 11. 关键文件清单

- `src/App.tsx` 顶层(标题「JNL学习小助手」+ AuthGate 包裹)
- `src/components/Workspace.tsx` 主体, 标签栏(含配置/管理员条件渲染)、四种复习模式、总览中英子标签、检测管理员邮箱
- `src/components/LearnInput.tsx` 录入(英文/中文切换、拆词/拆字预览、可删除 token、学习日期)
- `src/components/ReviewSession.tsx` 复习(lang + spellingOnly 过滤, AI 例句, 倒计时, 乐观评分, 队尾补做, 删除当前词)
- `src/components/WordList.tsx` 总览(lang 过滤、熟悉度筛选、批量删除、波动率)
- `src/components/StatsBoard.tsx` 统计(连续学习、今日中英文到期、明日预测、7天趋势)
- `src/components/Settings.tsx` 配置(倒计时、四类每日上限、云端提交、数据共享)
- `src/components/Changelog.tsx` 版本更新框 + 用户建议输入框(仅录入页渲染)
- `src/components/AdminPanel.tsx` 管理员页面
- `src/lib/tokenizer.ts` 拆词(tokenize/tokenizeZh/tokenizeByLang)
- `src/lib/wordService.ts` 录入、到期队列、评分更新、当天补做与波动率写入
- `src/lib/ai.ts` 例句前端调用; `api/generate-sentence.ts` 服务端 Qwen 代理
- `src/lib/userSettings.ts` 用户配置云端读写
- `src/lib/dataShare.ts` 数据共享 RPC 前端封装
- `src/lib/statsService.ts` 统计与熟练度波动率计算
- `src/lib/admin.ts` 管理员 RPC + ADMIN_EMAIL(写死管理员邮箱)
- `src/lib/changelog.ts` 版本日志数据(顶部加新版本)
- `src/lib/sm2.ts` 儿童版 SM-2 算法参数与读/拼写阈值
- `supabase/schema.sql` 数据库结构+RLS+管理员函数+数据共享函数(需重跑生效)
- `DEPLOY.md` 阿里云部署指南; `vercel.json` Vercel 配置
- `.env.local` 本地密钥(未提交, 含 VITE_SUPABASE_* 和 QWEN_API_KEY); `.env.example` 模板

> 管理员邮箱写死在两处, 换人需同时改: `src/lib/admin.ts` 的 ADMIN_EMAIL 和 schema.sql 的 is_admin()。
