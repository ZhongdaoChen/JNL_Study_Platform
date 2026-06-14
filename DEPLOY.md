# 部署到阿里云 OSS 静态网站托管

本应用是纯前端（React 打包为静态文件，数据走 Supabase 云端），用阿里云 **OSS 静态网站托管**最简单便宜。

> ⚠️ 你的阿里云账号登录、实名认证、付费、域名注册与 ICP 备案，必须本人在阿里云控制台完成。本文档给出精确步骤。

---

## 准备工作（重要）

1. **域名**：jnlstudy.com（在阿里云「域名」服务注册购买，需实名认证）。
2. **ICP 备案**：域名要解析到中国大陆服务器/OSS，**法律强制要求先备案**。
   - 阿里云控制台 → 备案 → 按引导提交（实名 + 审核，约 1–20 个工作日）。
   - 未备案前，可先用 OSS 默认访问域名测试，但不能绑定自有域名对外。
3. **Supabase 后台**：确认已在 Supabase 项目 SQL Editor 执行 `supabase/schema.sql`（建表 + RLS），否则线上注册/录入会报错。
4. 注意：生产包内嵌了 Supabase 的 **anon key**。这是公开密钥（设计上可暴露），安全性由数据库 RLS 行级策略保证，不要把 `service_role` 密钥放进前端。

---

## 一、构建生产包

```bash
npm install
npm run build
```

产物在 `dist/` 目录（约 0.4 MB）。后续上传的就是这个目录里的内容。

---

## 二、创建并配置 OSS Bucket

1. 开通 **对象存储 OSS**：阿里云控制台 → 对象存储 OSS → 立即开通。
2. 创建 Bucket：
   - 名称：如 `jnlstudy-web`（全局唯一）
   - 地域：选离用户近的，如「华东1（杭州）」
   - 读写权限：**公共读**（Public Read）
3. 关闭「阻止公共访问」开关（Bucket 设置里），否则网页打不开。

---

## 三、上传网站文件

方式 A（控制台手动）：
- 进入 Bucket → 文件管理 → 上传 `dist/` 目录下**所有文件和子目录**（含 `index.html`、`assets/`、`favicon.svg` 等），保持目录结构。

方式 B（命令行 ossutil，推荐自动化）：
```bash
# 安装并配置 ossutil（填入你的 AccessKey）后：
ossutil cp -r ./dist oss://jnlstudy-web/ --update
```

---

## 四、开启静态网站托管

Bucket → 数据管理 → **静态页面**：
- 默认首页：`index.html`
- 默认 404 页：`index.html`（本应用是单页应用，回退到首页即可）
- 保存。

此时可用 OSS 给的 **Bucket 域名** 先测试访问（形如 `https://jnlstudy-web.oss-cn-hangzhou.aliyuncs.com/index.html`）。

---

## 五、绑定自有域名 + HTTPS

> 需域名已完成 ICP 备案。

1. Bucket → 传输管理 → **域名管理** → 绑定自定义域名 `www.jnlstudy.com`。
2. 按提示在阿里云 **云解析 DNS** 给 `www` 添加一条 **CNAME** 记录，指向 OSS 提供的 CNAME 地址。
3. （根域名 `jnlstudy.com` → `www` 跳转）可在 DNS 加一条显性 URL 转发，或单独绑定。
4. **HTTPS**：在「域名管理」里上传/申请 SSL 证书（阿里云有免费 DV 证书），为 `www.jnlstudy.com` 开启 HTTPS。

建议进一步：用阿里云 **CDN** 加速 + 强制 HTTPS，提升国内访问速度。

---

## 六、Supabase 侧最后配置

1. Supabase → Authentication → URL Configuration：把 **Site URL** 设为 `https://www.jnlstudy.com`，并在 Redirect URLs 里加入该地址，否则邮箱登录回跳会失败。
2. 自用建议关闭邮箱验证：Authentication → 关闭 **Confirm email**（否则注册需邮箱点链接）。

---

## 七、以后更新网站

每次改完代码：
```bash
npm run build
ossutil cp -r ./dist oss://jnlstudy-web/ --update
```
若用了 CDN，记得在 CDN 控制台**刷新缓存**，让用户拿到新版本。

---

## 费用预估（个人小流量）

- OSS 存储 + 流量：每月通常几元以内
- 域名：约 ¥60–80/年（.com）
- 证书：免费 DV
- CDN（可选）：按量，小流量很低

---

## 常见问题

- **打开是空白/403**：检查 Bucket 是否「公共读」且未阻止公共访问；静态页面首页是否设为 `index.html`。
- **登录/录入报错**：确认 `schema.sql` 已执行、Supabase Site URL 已配置。
- **绑定域名失败**：多半是未完成 ICP 备案，或 CNAME 未生效（DNS 需几分钟到几小时）。
