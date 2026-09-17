- 将design token 记录在`design_doc.md` 中
- 每次修改编译后用 playwright mcp 截图检查。

## 构建与发布

- 仓库缺少 `tsconfig.json`，`npm run build`（`tsc && vite build`）会失败；用 `npx vite build` 直接构建。
- 在 `experiment` 分支上开发，完成后 `git push origin experiment`（用 gh 账号 `ayx-dg` 推送）。
- 自动部署：推送到 `experiment` 会触发 `.github/workflows/netlify-deploy.yml`（install → `npx vite build` → 写 `dist/_redirects` → `netlify deploy --prod --no-build`），约 2 分钟发布到 https://cipherbridge-fhe-ayxdg.netlify.app 。使用的仓库 Secrets：`NETLIFY_AUTH_TOKEN`、`NETLIFY_SITE_ID`。`gh run list -R ayx-dg/CipherBridge-Frontend --branch experiment` 查看状态。
- 手动部署（备用，等同于自动流程）：
  ```bash
  printf '/*    /index.html   200\n' > dist/_redirects
  env -u HTTP_PROXY -u HTTPS_PROXY -u http_proxy -u https_proxy \
    npx netlify deploy --prod --no-build --site f9e27df1-1a86-4a0c-ad45-b3a317a46836 --dir dist
  ```
  生产站点：https://cipherbridge-fhe-ayxdg.netlify.app
  （Netlify CLI 已登录 `ayx-dg`；网络代理 `127.0.0.1:10809` 会干扰 Netlify/gh，需 `env -u ...` 去除 proxy。）

## 移动端 Responsive 修复（已应用）

- Header 钱包按钮文字用 `!hidden sm:!inline`（加 `!important` 覆盖 antd `.ant-btn>span` 的 `display:block`）+ `.ant-layout-header{flex-wrap:wrap}` + `@media(max-width:640px){padding:0 16px}`。
- Portal 页表格用 `overflow-x-auto` 包裹、`Radio.Group` 加 `flex-wrap`、内容列加 `w-full`，避免移动端页面级水平滚动。
