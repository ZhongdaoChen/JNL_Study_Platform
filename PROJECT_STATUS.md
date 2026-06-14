# 项目状态与上下文存档（PROJECT_STATUS）

> 本文件用于让新的 Copilot 会话快速恢复上下文。记录项目目标、架构、部署、进度与待办。
> 最后更新：2026-06-14

---

## 1. 项目目标

一个帮助家长陪 **5 岁女儿** 学习英语的应用「**JNL学习小助手**」。
- 家长每天录入新学的英文句子 → 自动拆成单词 → 跟踪每个单词的记忆
- 基于「儿童版 SM-2」间隔重复算法，安排每天该复习的单词
- 复习时家长对每个词打三档（熟练 / 略陌生 / 彻底陌生），自动更新复习计划
- 未来可能开放给其他用户使用（已按多用户架构设计）

## 2. 已确认的产品决策

- 形态：**网页应用（PWA 方向）**，React + TypeScript + Vite
- 操作者：**家长为主**，孩子在旁跟读（界面偏家长操作）
- 发音：暂不做（仅文字 + 记忆跟踪）
- 跟踪粒度：**以单词为主**，句子作为语境保留
- 数据：**多设备同步**，需账号；用 Supabase
- 算法：**儿童版 SM-2**（三档评分、首答次日、间隔上限约 21 天）
- 复习：**不设每日上限**，列出全部到期词；进度天然持久化（评分即写库，重进可继续）

## 3. 技术架构

```
前端 (React + TS + Vite, 纯静态)
  ├─ 组件: AuthGate(登录门) → Workspace(主体)
  │        Workspace 内含 4 个标签: 录入/复习/总览/统计
  └─ 逻辑层 src/lib/
       tokenizer.ts   拆词(正则只留英文单词, 排除 6/10、数字等)
       sm2.ts         儿童版 SM-2 算法 (参数集中在 SM2_CONFIG)
       date.ts        日期工具(YYYY-MM-DD)
       wordService.ts 业务: addLearning / getDueReviews / submitReview
       statsService.ts 统计: 打卡/掌握数/7天趋势
       repo.ts        仓储接口(抽象)
       localRepo.ts   本地存储实现(localStorage)
       supabaseRepo.ts Supabase 实现
       supabase.ts    Supabase 客户端(读 env)
       db.ts          仓储单例: 有 env 密钥→云端, 否则→本地
            │ HTTPS
后端 Supabase (Postgres + Auth + RLS 行级安全多用户隔离)
```

### 仓储可切换设计
- UI 只依赖 `Repo` 接口。
- `db.ts` 根据是否配置了 `VITE_SUPABASE_URL/ANON_KEY` 决定用 `SupabaseRepo`(云端) 还是 `LocalRepo`(本地)。

## 4. 数据库结构 (supabase/schema.sql)

4 张表，全部启用 RLS，按 `auth.uid()` 隔离（每个家长只看自己数据）：
- `children`(owner=auth.uid(), name, created_at)
- `sentences`(child_id, text, created_at)
- `words`(child_id, text, sentence_ids[], first_learned_at, interval, ef, repetitions, due_date, last_grade, last_reviewed_at, unique(child_id,text))
- `review_logs`(child_id, word_id, grade, reviewed_at)
- 辅助函数 `owns_child(cid)` 用于子表 RLS 策略。

> ⚠️ 部署后必须在 Supabase SQL Editor 执行 `supabase/schema.sql` 建表+RLS，否则线上注册/录入会报错。

## 5. 儿童版 SM-2 规则 (src/lib/sm2.ts)

- 三档评分: mastered(熟练) / fuzzy(略陌生) / forgotten(彻底陌生)
- 新词初始: interval=1, ef=2.5, 次日(learnedOn+1)首次复习
- mastered: rep1→1天, rep2→3天, 之后 ×ef; ef+0.1
- fuzzy: rep1→1天, rep2→2天, 之后 ×1.3; ef-0.1
- forgotten: 归零(rep=0, interval=1, 明日重学); ef-0.2
- 间隔上限 21 天(MAX_INTERVAL), ef 下限 1.3
- 「已掌握」统计口径: repetitions >= 3

## 6. 仓库 / 代码托管

- GitHub: **git@github.com:ZhongdaoChen/JNL_Study_Platform.git** (SSH, 账号 ZhongdaoChen)
- 默认分支: `main`
- 本地路径: `/Users/chenpet/PeterChen/xiaorenwu`
- 提交历史:
  - `fdac49f` Initial commit
  - `27ca888` 修复复习进度/计数、去上限、显示总数、加部署配置
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
- 部署后: 把 Vercel 网址填到 Supabase Authentication → Site URL
- 免费额度对个人足够; 备案完成后可在 Vercel 绑定 jnlstudy.com(也免备案/免费 HTTPS)

## 9. 当前进度

### 已完成
- [x] P0 骨架: Vite+React+TS, 拆词, SM-2, 三模块 UI, 本地存储
- [x] P1: Supabase 客户端 + SupabaseRepo + 邮箱登录(AuthGate) + RLS schema
- [x] 功能: 单词删除(单个+批量多选), 录入可选学习日期(默认今天)
- [x] 拆词正则: 只存英文单词, 排除 6/10、纯数字、cat/dog 等
- [x] 学习统计看板(打卡/掌握进度/7天趋势)
- [x] 改名为「JNL学习小助手」
- [x] git 初始化并推送 GitHub
- [x] 修复复习计数错乱(refreshKey 导致重置)、去除每日上限、显示今日复习总数
- [x] 写好 DEPLOY.md(阿里云) 与 vercel.json

### 进行中
- [ ] Vercel 部署(用户已邮箱登录, 待绑定 GitHub→导入→设环境变量→Deploy)
- [ ] Supabase: 关闭邮箱验证、设 Site URL、确认已执行 schema.sql
- [ ] 阿里云 ICP 备案(并行长期任务)

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
npm run preview    # 预览生产包
git add -A && git commit -m "..." && git push   # 提交并自动触发 Vercel 部署
```

## 11. 关键文件清单

- `src/App.tsx` 顶层(标题「JNL学习小助手」+ AuthGate 包裹)
- `src/components/Workspace.tsx` 主体, 4 标签
- `src/components/ReviewSession.tsx` 复习(进度持久化在此, effect 依赖仅 [childId])
- `src/lib/sm2.ts` 算法参数
- `supabase/schema.sql` 数据库结构+RLS
- `DEPLOY.md` 阿里云部署指南
- `vercel.json` Vercel 配置
- `.env.local` 本地密钥(未提交); `.env.example` 模板
