# 设计更改文档 / Design Change Log

> 分支：`experiment`
> 项目：CipherBridge (FHE-Frontend)
> 目标：在不改变功能的前提下，重塑视觉风格，与原系统（靛蓝 + 顶栏）形成明显区分。
> 新设计方向：**「Emerald Fresh」翡翠清新风** —— 翡翠绿主色 + 左侧栏布局 + 更大圆角 + 绿色光晕阴影。
> 构建验证：`npx vite build` 通过（3606 modules，无错误）。

---

## 1. 主色调变更（Color · Primary）

**文件：** `src/index.css` → `:root` 变量
**文件：** `src/App.tsx` → antd `theme.token.colorPrimary`

| Token | 原值（靛蓝 Indigo） | 新值（翡翠绿 Emerald） |
|---|---|---|
| `--primary-color` | `#6366F1` | `#10B981` |
| `--primary-light` | `#818CF8` | `#34D399` |
| `--primary-dark` | `#4F46E5` | `#059669` |
| antd `colorPrimary` | `#1890FF`（蓝） | `#10B981`（绿） |

说明：从「冷调靛蓝」切换为「自然翡翠绿」，并在 antd 主题中同步 `colorPrimary`，消除原系统中靛蓝/蓝/蓝-600 三套主色并存的冲突，统一为单一绿色主色。

---

## 2. 中性色 / 背景 / 文字变更（Color · Neutrals）

**文件：** `src/index.css` → `:root`

| Token | 原值 | 新值 | 意图 |
|---|---|---|---|
| `--bg-color` | `#F8FAFC`（冷灰白） | `#ECFDF5`（薄荷白绿） | 整体背景带绿调 |
| `--card-bg` | `#FFFFFF` | `#FFFFFF`（不变） | 卡片保持纯白以突出 |
| `--text-primary` | `#1E293B`（深蓝灰） | `#064E3B`（深松绿） | 文字带绿调 |
| `--text-secondary` | `#64748B` | `#6B7280`（中性灰） | 次文字保持易读 |
| `--border-color` | `#E2E8F0`（冷灰） | `#D1FAE5`（浅绿） | 边框带绿调 |

说明：背景、文字、边框整体转向「绿系冷调」，与原冷灰系统区分。

---

## 3. 圆角变更（Border Radius）—— 更圆润柔和

**文件：** `src/index.css`

| 元素 | 原值 | 新值 |
|---|---|---|
| 卡片 `.ant-card` | `16px` | `20px` |
| 弹窗 `.custom-modal` | `16px` | `20px` |
| 表格 `.custom-table` | `12px` | `16px` |
| 输入框 `.ant-input` | `8px` | `12px` |
| 标签 `.ant-tag` | `6px` | `10px` |
| 菜单项选中态 | （无） | `12px`（新增） |

说明：全面提升圆角，营造更柔和、现代的「气泡感」视觉，与原系统偏直角的克制风格形成对比。

---

## 4. 阴影变更（Elevation）—— 绿色光晕

**文件：** `src/index.css`

| 元素 | 原阴影 | 新阴影 |
|---|---|---|
| Header | `0 2px 8px rgba(0,0,0,0.08)` | `0 1px 3px rgba(0,0,0,0.06)`（更轻） |
| 卡片 | `0 4px 6px -1px rgba(0,0,0,.1), 0 2px 4px -1px rgba(0,0,0,.06)` | `0 10px 30px -12px rgba(16,185,129,0.25)`（绿色光晕） |
| 卡片 hover | `0 10px 15px -3px ..., translateY(-2px)` | `0 20px 40px -12px rgba(16,185,129,0.35), translateY(-4px)`（更强悬浮） |
| 主按钮 | `0 2px 4px rgba(99,102,241,0.2)` | `0 6px 16px -4px rgba(16,185,129,0.4)` |
| 主按钮 hover | `0 4px 6px rgba(99,102,241,0.25)` | `0 10px 22px -4px rgba(16,185,129,0.5), translateY(-2px)` |
| 弹窗 | `0 20px 25px -5px ..., 0 10px 10px -5px ...` | `0 24px 48px -12px rgba(0,0,0,0.18)` |
| 侧边栏（新增） | — | `2px 0 12px rgba(16,185,129,0.06)` |

说明：阴影由「中性黑灰」改为「带主色的绿色光晕」，强化品牌色渗透；卡片悬浮位移由 -2px 加大到 -4px，交互反馈更明显。

---

## 5. 布局变更（Layout）—— 顶栏 → 左侧栏

**文件：** `src/components/Layout.tsx`（重构）
**文件：** `src/index.css`（新增 `.ant-layout-sider`、`.app-logo`、`.ant-layout-header` 调整）

| 维度 | 原设计 | 新设计 |
|---|---|---|
| 导航结构 | 顶部 `Header` 横向 `Menu`（horizontal） | 左侧 `Sider` 纵向 `Menu`（inline），宽 `240px` |
| Header | 含 Logo + 菜单 + 钱包按钮 | 仅右侧钱包按钮（Logo 移到侧栏顶部） |
| 侧栏 | 无 | 白色背景 + 右侧绿调阴影 + sticky 满高 |
| 菜单交互 | hover `text-blue-600`（Tailwind） | 选中态 `rgba(16,185,129,0.12)` 背景 + `12px` 圆角 + 深绿字；hover 变深绿 |
| 内容区 | `.page-container` `max-width:1200px` | 去除最大宽度限制，`padding:32px`，随侧栏自适应 |
| Logo | 高度 `40px`，置于顶栏 | 高度 `44px`，居中于侧栏顶部（`margin:20px auto`） |

说明：将原「顶部横向导航」彻底改为「左侧固定纵向导航」，这是与原系统最显著的视觉/结构差异；同时菜单点击通过 `useNavigate` 路由跳转（原为 `<Link>` 包裹）。

---

## 6. 字体排版微调（Typography）

**文件：** `src/index.css`、antd token

| 元素 | 原值 | 新值 |
|---|---|---|
| `.section-title` | `24px / 600` | `26px / 700` + `letter-spacing:-0.3px` |
| 标题 `h1-h5` 字重 | `600` | `700` |
| 侧栏菜单字号 | `16px / 500`（横向） | `15px / 500`（纵向） |
| antd `colorText` | （默认） | `#064E3B` |
| antd `colorBorder` | （默认） | `#D1FAE5` |
| antd `borderRadius` | （默认 6） | `10` |

说明：标题字重加粗到 700，字号略增；antd 文字/边框色同步为绿系，使组件框架与自定义样式一致。

---

## 7. 其他细节

- **表格 hover 行底色**：`rgba(99,102,241,0.05)` → `rgba(16,185,129,0.06)`
- **输入框 focus 光环**：`0 0 0 2px rgba(99,102,241,0.2)` → `0 0 0 3px rgba(16,185,129,0.18)`
- **Badge / Tag**：阴影与 padding 改为绿系（`10px` 圆角、padding `4px 10px`）
- **菜单选中/悬浮**：新增 `.ant-menu-item-selected` 与 `.ant-menu-item:hover` 样式（绿色背景圆角）

---

## 8. 色彩体系改用 Material 3 (M3) 规范（仅改色调）

**范围：** 仅替换颜色（色调 / Color），布局、圆角、阴影结构、排版保持不变（相对 §1–§7 的「翡翠绿」版本）。
**来源：** [Material 3 官方 Baseline 色板](https://m3.material.io/styles/color/roles)（material-web `md-sys-color` 基准值）。
**改动文件：** `src/index.css`（`:root` 变量 + 所有透明光晕色）、`src/App.tsx`（`colorPrimary` 等 antd token）。

### 8.1 M3 角色 → 项目 CSS 变量映射

| M3 角色 (role) | M3 取值 (Baseline) | 映射到的变量 | 原「翡翠绿」值 |
|---|---|---|---|
| `primary` (tone 40) | `#6750A4` | `--primary-color` | `#10B981` |
| `primary-container` (tone 90) | `#EADDFF` | `--primary-light` | `#34D399` |
| `on-primary-container` (tone 10) | `#21005D` | `--primary-dark` | `#059669` |
| `background` (tone 98) | `#FFFBFE` | `--bg-color` | `#ECFDF5` |
| `surface` | `#FFFFFF` | `--card-bg` | `#FFFFFF` |
| `on-surface` (tone 10) | `#1C1B1F` | `--text-primary` | `#064E3B` |
| `on-surface-variant` (tone 30) | `#49454F` | `--text-secondary` | `#6B7280` |
| `outline-variant` (tone 80) | `#CAC4D0` | `--border-color` | `#D1FAE5` |

> 另新增辅助变量 `--m3-primary-rgb: 103, 80, 164`，供所有 `rgba()` 透明光晕（卡片/按钮/输入框/Badge/侧栏/菜单选中态/表格 hover）复用，避免散落硬编码。

### 8.2 antd 主题 Token 同步（`src/App.tsx`）

| Token | 原「翡翠绿」值 | 新 M3 值 |
|---|---|---|
| `colorPrimary` | `#10B981` | `#6750A4` |
| `colorText` | `#064E3B` | `#1C1B1F` |
| `colorBorder` | `#D1FAE5` | `#CAC4D0` |
| `borderRadius` | `10` | `10`（不变） |

### 8.3 透明光晕色重着色（retint）

所有原本使用翡翠绿 `rgba(16,185,129,…)` 的位置，统一改为 M3 主色 `rgba(103,80,164,…)`：

| 位置 | 透明度/作用 | 变化 |
|---|---|---|
| 侧栏阴影 | `0.06→0.08` | 绿 → 紫 |
| 卡片阴影 | `0.25` / hover `0.35` | 绿 → 紫 |
| 主按钮阴影 | `0.4` / hover `0.5` | 绿 → 紫 |
| 输入框 focus 光环 | `0.18` | 绿 → 紫 |
| Badge 阴影 | `0.4` | 绿 → 紫 |
| 菜单选中 / hover 背景 | `0.12` | 绿 → 紫 |
| 表格行 hover 底色 | `0.06→0.08` | 绿 → 紫 |
| 表格表头背景 | `#F0FDF4` → `#E7E0EC` | 绿底 → M3 `surface-variant` |

### 8.4 设计要点

- 采用 M3 **Baseline** 参考色板（紫调），是 Material 3 官网的规范基准；如需其他品牌色，可用 [Material Theme Builder](https://material-foundation.github.io/material-theme-builder/) 以任意种子色生成同样结构的 M3 角色集合后替换上述取值。
- 角色命名遵循 M3：`primary / primary-container / on-primary-container / background / surface / on-surface / on-surface-variant / outline-variant`，保证与 Material 生态一致。
- 仅改色调，未触碰 §5 的布局（侧栏）、§3 的圆角、§4 的阴影偏移量，因此视觉结构仍与「翡翠绿」版本一致，仅配色由绿转紫。

---

## 视觉差异小结（Before → After）

| 维度 | Before（原系统） | After（experiment 分支 · M3 版） |
|---|---|---|
| 主色 | 靛蓝 `#6366F1` + 蓝 `#1890FF` 混合 | M3 紫 `#6750A4` 统一 |
| 背景 | 冷灰白 `#F8FAFC` | M3 `#FFFBFE` |
| 导航 | 顶部横向栏 | 左侧固定纵向栏 |
| 圆角 | 6–16px（偏直角） | 10–20px（柔和圆润） |
| 阴影 | 中性黑灰 | M3 主色紫色光晕 |
| 标题字重 | 600 | 700 |
| 色板规范 | 自定义 | Material 3 Baseline 角色体系 |

> 备注：原仓库缺少 `tsconfig.json`，`npm run build` 中的 `tsc` 步骤会失败；本次验证使用 `npx vite build` 直接构建通过。建议后续补回 `tsconfig.json`。
> 文件名已从 `desgin_doc.md` 修正为 `design_doc.md`。

---

## 9. 布局微调：侧栏右置 + Logo 移出侧栏 + 首页 Portal 卡宽度

**相较原始文件（`src/components/Layout.tsx` 原版、`src/pages/Home.tsx` 原版）的改动。**
**改动文件：** `src/components/Layout.tsx`、`src/pages/Home.tsx`
**构建验证：** `npx vite build` 通过。

### 9.1 全局布局：aside（Sider）移到右侧，Logo 移到 aside 外（`Layout.tsx`）

原版结构（左侧栏）：
```
AntLayout
 ├─ Sider (左, 内含 app-logo + Menu)
 └─ AntLayout
      ├─ Header (仅钱包按钮)
      └─ Content
```
新版结构（右侧栏）：
```
AntLayout
 ├─ AntLayout
 │    ├─ Header (左: app-logo / 右: 钱包按钮)
 │    └─ Content
 └─ Sider (右, 仅 Menu，无 logo)
```

| 改动点 | 原版 | 新版 |
|---|---|---|
| 侧栏位置 | 左侧（`Sider` 为第一个子元素） | **右侧**（`Sider` 置于 `AntLayout` 之后） |
| `app-logo` 位置 | 在 `Sider` 内部（`<Link><img className="app-logo"></Link>`） | **移出 `Sider`**，放入 `Header` 左侧 |
| `app-logo` 样式 | `.app-logo` 类含 `margin:20px auto`（用于侧栏居中） | Header 内联 `style={{ margin: 0 }}` 覆盖，左对齐 |
| Header 内容 | 仅右侧钱包按钮（`marginLeft:auto`） | 左侧 Logo + 右侧钱包按钮（Logo 后 `marginLeft:auto` 推开） |

> 说明：仅调整 DOM 顺序与 Logo 位置，未改动侧栏宽度（240px）、sticky 行为、菜单项与选中态样式。

### 9.2 首页：Portal 卡片宽度与配色（`Home.tsx`）

| 改动点 | 原版 | 新版 | 目的 |
|---|---|---|---|
| Portal 卡片容器宽度 | `max-w-5xl` (1024px) | `max-w-4xl` (896px) + `mx-auto` | 解决「Client/Bank Portal 太宽」 |
| 卡片排布 | `grid-cols-1 md:grid-cols-2` | 同左（保持不变） | 两卡**同一水平**并排 |
| Hero 背景渐变 | `from-blue-50 to-white` | `from-[#EADDFF]/50 to-white` | 蓝色 → M3 `primary-container` 浅紫 |
| 标题渐变文字 | `from-blue-600 to-blue-400` | `from-[#6750A4] to-[#9A82D0]` | 蓝色 → M3 `primary` 及浅紫 |
| 图标圆形底 | `bg-blue-50` / `text-blue-500` | `bg-[#EADDFF]` / `text-[#6750A4]` | 蓝色 → M3 主色系 |

> 说明：首页原版仍残留「靛蓝/蓝」硬编码 Tailwind 类，与 §8 M3 紫色体系冲突；本次一并改为 M3 主色（primary `#6750A4`、primary-container `#EADDFF`），保持全局一致。卡片 `hover:scale-105 shadow-lg` 等交互类保持不变。

### 9.3 视觉差异小结（本轮）

| 维度 | 原版（本分支此前） | 本轮后 |
|---|---|---|
| 侧栏位置 | 左侧 | **右侧** |
| Logo 位置 | 侧栏内 | **Header 内（侧栏外）** |
| 首页 Portal 卡 | `max-w-5xl`（偏宽） | `max-w-4xl`（收窄、并排） |
| 首页蓝→紫 | 靛蓝渐变 | M3 紫色系 |

---

## 10. 布局再调整：导航 aside 移入 Home 内容区（右侧、welcome 下方）

**相较 §9 版本（`Layout.tsx` 右置 `Sider`、`Home.tsx` 仅 Portal 卡）的改动。**
**改动文件：** `src/components/Layout.tsx`、`src/pages/Home.tsx`
**构建验证：** `npx vite build` 通过。

### 10.1 全局布局：移除全高 Sider（`Layout.tsx`）

| 改动点 | §9 版本 | 本轮后 |
|---|---|---|
| 导航容器 | 全局 `Sider`（右侧，从顶部 sticky 满高） | **移除** `Sider`，仅保留 `Header` + `Content` |
| 导航位置 | 独立于内容、贯穿全页高度 | 导航进入 Home 内容区内部（见 §10.2） |
| `<Sider>` 导入 | 使用 `Sider` | 不再使用（保留 `Header, Content`） |
| Header | 左 Logo + 右钱包按钮 | 不变 |

> 说明：因导航不再作为全局侧栏，Client/Bank Portal 等子页不再自动带导航；导航仅出现在 Home 页内容区内（按需求「与两个 Portal 同一容器内」）。

### 10.2 首页：aside 置于 Portal 右侧、welcome 下方（`Home.tsx`）

页面结构（本轮）：
```
Hero (Welcome 文字，顶部居中)
└─ 同一容器 flex-row (max-w-5xl, mt-4, gap-8)
     ├─ 左：Portal 卡片 grid (Client / Bank)  flex-1
     └─ 右：<aside> 导航（最右，低于 welcome）
```

| 改动点 | 之前 | 本轮 |
|---|---|---|
| aside 起点 | 从页面顶部开始（全局侧栏） | **从 welcome 文字下方开始**，与 Portal 同容器 |
| aside 水平位置 | 页面最右（全局） | 容器最右，紧邻 Portal 卡右侧 |
| 边框 | — | **无新边框**（仅 `rounded-2xl` 圆角，无 border） |

### 10.3 aside 仅靠「背景 + 字体」区分，不引入新颜色

| 区分手段 | 取值 | 来源（均为既有 M3 颜色，无新增） |
|---|---|---|
| 背景 | `bg-[#EADDFF]`（primary-container） | M3 `primary-container` `#EADDFF` |
| 标题字体 | `text-xs font-semibold tracking-[0.2em] uppercase text-[#6750A4]` | `primary` `#6750A4` |
| 链接字体 | `text-base font-medium` / 激活态 `font-bold` | 字体字重区分 |
| 链接颜色 | `text-[#21005D]`（primary-dark）/ 激活 `text-[#6750A4]` | `on-primary-container` / `primary` |
| 激活/悬停底 | `bg-[#6750A4]/15`、`hover:bg-[#6750A4]/10` | 主色透明度，非新色 |
| 圆角 | `rounded-2xl` / `rounded-xl` | 仅圆角，无边框 |

> 说明：严格复用 §8 定义的 M3 调色板（`#6750A4` / `#EADDFF` / `#21005D`），**未引入任何新颜色**；区域差异仅由背景底色与字体（大小、字重、字距、大小写）体现，且**不增加可见边框**。

### 10.4 视觉差异小结（本轮）

| 维度 | §9 版本 | 本轮后 |
|---|---|---|
| 导航形态 | 全局右侧 Sider（满高） | Home 内容内 aside（welcome 下方、Portal 右侧） |
| 可见边框 | 无 | 无（仍无边框） |
| 区域区分 | 侧栏阴影/底色 | aside 仅靠 `#EADDFF` 背景 + 字体区分 |
| 新颜色 | 无 | 无（沿用 M3 调色板） |

---

## 11. 根因修复：补齐 PostCSS/Tailwind 配置（§10 样式缺失的真正原因）

**问题现象：** §10 提交后，运行时 aside 失去样式（无背景/圆角）且堆叠到最底部而非右侧。
**根因：** 项目缺少 `postcss.config.js`，导致 Vite 构建/开发时 **Tailwind 从未被编译**。`src/index.css` 中的 `@tailwind base/components/utilities` 指令无效，`src/**` 组件里所有 Tailwind 工具类（`flex`、`grid`、`max-w-*`、`rounded-*`、`bg-[#EADDFF]`、`md:flex-row` 等）均不生效；之前 CSS 中出现的 `EADDFF` 仅来自 `:root` 的 `--primary-light` 变量，并非 `.bg-[#EADDFF]` 类。这正是 §9「Portal 太宽」（grid/max-w 未生效）与 §10「aside 无样式、沉底」的共同根因。

**修复：** 新增 `postcss.config.js`：

```js
export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
}
```

**验证（`npx vite build` 后检查产物 CSS）：**
| 检查项 | 修复前 | 修复后 |
|---|---|---|
| `.flex{display:flex}` | 不存在 | 存在 |
| `@media (min-width:768px) .md\:flex-row` | 不存在 | 存在 |
| `rounded-2xl` (`border-radius:1rem`) | 不存在 | 存在 |
| `.bg-\[#EADDFF\]` 规则 | 不存在 | 存在 |

修复后：§10 的 `flex flex-col md:flex-row` 生效 → 桌面端（≥768px）Portal 卡居左、`aside` 居右；`bg-[#EADDFF]`/`rounded-2xl`/`p-6` 等生效 → aside 恢复背景与字体区分；移动端（<768px）仍纵向堆叠（aside 在底部），符合响应式预期。

> 备注：启用 Tailwind preflight 后，部分原生 HTML 元素默认样式会被重置，但 antd v5 采用 CSS-in-JS（`:where()` 低优先级选择器 + 组件类名）不受影响，构建与组件样式正常。

---

## 12. 交互修复：导航在所有页面常驻（提取为共享 SiteNav 组件）

**问题现象：** §10 将导航 `aside` 仅放在 Home 页内容区内；点击「Enter Client/Bank Portal」进入子页后，导航消失（子页无导航），交互被破坏。
**修复：** 将导航抽取为共享组件 `src/components/SiteNav.tsx`，并在 `Home` / `ClientPortal` / `BankPortal` 三个页面均渲染，保证导航在各页常驻。

| 改动文件 | 改动 |
|---|---|
| `src/components/SiteNav.tsx`（新增） | 原 Home 内联 `aside` 导航抽取为独立组件（导航项、激活态、`#EADDFF` 背景、字体区分、无边框均保留） |
| `src/pages/Home.tsx` | 删除内联 `aside`，改引用 `<SiteNav />`（位置/样式不变：welcome 下方、Portal 右侧） |
| `src/pages/ClientPortal.tsx` | 内容包入 `flex flex-col md:flex-row` 行，主区 `flex-1 min-w-0` + 右侧 `<SiteNav />` |
| `src/pages/BankPortal.tsx` | 同上，主区含两张 Card，右侧 `<SiteNav />`；`min-w-0` 防止内部表格溢出 |

**布局行为（桌面 ≥768px）：** 每个页面均为「主内容区（左，flex-1）+ 导航面板（右，md:w-64）」；移动端（<768px）导航面板堆叠到主内容下方。
**视觉/配色：** 沿用 §10 —— 仅 `#EADDFF` 背景 + 字体区分，无新边框、无新颜色。
**构建验证：** `npx vite build` 通过。

> 说明：由此前「导航仅首页存在」导致的「进入子页导航消失」问题已解决；同时保留首页要求的 aside 位置（welcome 下、Portal 右、无边框、背景+字体区分）。

---

## 13. 响应式修正：小屏幕导航不再沉底（移动端置顶）

**问题现象：** 页面用 `flex flex-col md:flex-row` 布局，`< md`（<768px）时行方向变为 column，`SiteNav`（DOM 顺序在内容之后）被排到页面最底部，小屏体验差。
**修复：** 给 `SiteNav` 的 `<aside>` 加 `order-first md:order-none`，小屏时导航排到内容行首位（welcome 文字之后、Portal 卡之前），桌面端仍位于 Portal 右侧。

| 维度 | `md` (≥768px) | `< md` (移动端) |
|---|---|---|
| 行方向 | `flex-row` | `flex-col` |
| SiteNav `order` | `0`（`md:order-none`） | `-9999`（`order-first`） |
| SiteNav 位置 | 内容区右侧 | 内容区顶部（welcome 下方） |

**改动文件：** `src/components/SiteNav.tsx`（仅 `aside` className 追加 `order-first md:order-none`）
**验证：** 视口 390×844，实测 `getComputedStyle(aside).order = -9999`、父容器 `flex-direction: column`、`aside` 顶部 y≈387（紧邻 welcome 下方）；截图确认导航卡片位于 Portal 卡之前，不再沉底。
**构建验证：** `npx vite build` 通过（未被 `tsc` 阻断）。

> 说明：桌面端布局、配色、无边框样式均不受影响；仅移动端顺序改变。

---

## 14. main 分支 vs 当前 experiment 分支 · 样式改动对比

**目的：** 对比 `main`（旧基线，靛蓝/蓝，顶栏布局）与 `experiment`（当前，M3 紫色，aside 导航）的样式与品牌差异，便于回溯。
**分支关系：** `experiment` 领先 `main` 5 个提交。

### 14.1 核心差异总览

| 维度 | main（旧基线） | experiment（当前） |
|---|---|---|
| 主色 | 靛蓝 `#6366F1` + antd 蓝 `#1890FF` 混用 | M3 紫 `#6750A4` 统一（基线） |
| 背景 | 冷灰白 `#F8FAFC` | M3 `#FFFBFE` |
| 导航结构 | 顶部横向 `Header` 菜单 | aside 导航（Home 内：welcome 下、Portal 右；子页右栏） |
| 布局 | 顶栏 + 居中 `max-w-5xl` | aside + `flex-row` 主从布局 |
| 圆角 | 6–16px | 10–20px（更圆润） |
| 阴影 | 中性黑灰 | M3 主色紫色光晕 |
| 标题字重 | 600 | 700 |
| Tailwind | **未生效**（无 PostCSS） | **生效**（新增 `postcss.config.js`） |

### 14.2 样式相关文件变更（相对 main）

| 文件 | 状态 | 说明 |
|---|---|---|
| `postcss.config.js` | **新增** | 启用 `tailwindcss`+`autoprefixer`，使所有 Tailwind 工具类生效（根因修复，见 §11） |
| `src/index.css` | 大改 | `:root` 换为 M3 色板；卡片/按钮/输入框/表格/弹窗阴影与圆角焕新；新增侧栏/aside、`ant-message` 置底、响应式 Header 等样式 |
| `src/App.tsx` | 改动 | antd `colorPrimary` `#1890FF`→`#6750A4`，`colorText`/`colorBorder` 同步 M3 |
| `src/components/Layout.tsx` | 重写 | 移除 `Sider`；`Header` 仅 Logo（文字标识）+ 钱包按钮；无全高侧栏 |
| `src/components/SiteNav.tsx` | **新增** | 共享导航组件（`#EADDFF` 背景 + 字体区分、无边框、`order-first` 移动端置顶） |
| `src/pages/Home.tsx` | 大改 | M3 紫色渐变标题；Portal 卡 `max-w-4xl`；`p-6 sm:p-8`、按钮 `px-6 sm:px-8`；嵌入 `SiteNav` |
| `src/pages/ClientPortal.tsx` / `BankPortal.tsx` | 改动 | 内容列 `w-full min-w-0`、`SiteNav` 右栏、Bank 面板 `h-[400px] md:h-[600px]` |
| `src/components/client/Registration.tsx` | 改动 | `Col span={12}`→`xs={24} md={12}`（移动端单列，修溢出） |
| `src/components/client/TaskResults.tsx` | 改动 | 表格 `overflow-x-auto`、页签 `flex-wrap`、extra 按钮手机图标化 |
| `src/components/bank/TaskList.tsx` | 改动 | 表格加 `custom-table`、`overflow-x-auto`、页签 `flex-wrap` |
| `src/components/wallet/*.tsx` | 改动 | 按钮文字 `!hidden sm:!inline`（手机只显图标） |

### 14.3 交互上的结构性变化（影响视觉布局）

- **导航**：从「全局顶栏横向菜单」→「`SiteNav` 组件」。Home 页内嵌于内容区（welcome 下方、Portal 右侧）；Client/Bank 子页作为右侧边栏；移动端置顶排列。
- **Logo**：图片被去除，改用 `Cipher`(深)/`Bridge`(紫) 文字标识（原图片资源缺失，避免破图）。

### 14.4 验证状态

- 移动端（320/360/375/393/414）与桌面（1280）均无页面级水平溢出、无越界元素（`scripts/mobileCheck.cjs`，可复用）。
- `npx vite build` 通过。
- 已发布生产：https://cipherbridge-fhe-ayxdg.netlify.app

---

## 15. 导航合并进顶部 Header（RBC 风格）+ 子页返回按钮

**目标：** 参考 RBC（rbcroyalbank.com/personal.html）顶栏导航布局，将原先散落的 `SiteNav`（aside 侧栏）合并进顶部 `Header`，并为每个子页增加返回首页入口。

**布局（桌面 md+）：** 顶栏单行：品牌标识(左) → 横向导航链接(中，活动项紫色+底部边框) → 钱包按钮(右，`ml-auto`)。
**布局（移动端 <md）：** 顶栏：品牌标识(左) → 钱包图标按钮 + 汉堡菜单(右)。点击汉堡弹出下拉导航面板（活动项紫色+左侧边框+浅紫背景）。

| 维度 | 之前（§12 aside SiteNav） | 现在（§15 Header 顶栏） |
|---|---|---|
| 导航位置 | Home 内嵌 + 子页右侧栏 | 全局顶部 Header |
| 活动态 | 粉色块背景 | 紫色文字 + 底部 2px 边框（RBC 式） |
| 移动端 | aside `order-first` 置顶 | 汉堡菜单 + 下拉面板 |
| 子页返回 | 无 | 顶部「← Back to Home」按钮 |
| 子页布局 | 左侧内容 + 右侧 aside | 内容全宽（去除 aside） |

**改动文件：**
- `src/components/Layout.tsx`：重写 Header（品牌 + 桌面导航 + 钱包 + 移动端汉堡/下拉面板）。
- `src/components/SiteNav.tsx`：**删除**（导航并入 Layout）。
- `src/pages/Home.tsx`：移除 `SiteNav`，Portal 卡改为居中两列网格。
- `src/pages/ClientPortal.tsx` / `src/pages/BankPortal.tsx`：移除 `SiteNav`，新增「Back to Home」按钮（`ArrowLeftOutlined` + `Link to="/"`），内容改全宽。

**验证：** `npx vite build` 通过；`scripts/mobileCheck.cjs` 在 320/360/375/393/414/1280 全部无溢出；Playwright 视觉确认桌面顶栏链接/活动下划线正常、移动端汉堡下拉面板可展开、子页返回按钮与全宽内容布局正常。

---

## 16. 品牌重塑：融鉴 FinLens + 品牌紫罗兰色板 + 首页改版 + 全站中文化

**来源：** 品牌设计稿 `~/Downloads/mmexport1789442607306.jpg`（方案 03「聚焦棱镜」）。
**目标：** 依据设计稿更新 Logo / 品牌名（中文「融鉴」/ 英文 `FinLens`），首页按设计稿重做，并将全站界面语言切换为中文。
**改动文件：** `index.html`、`public/logo.svg`（新增）、`src/index.css`、`src/App.tsx`、`src/components/Layout.tsx`、`src/pages/Home.tsx`、`src/pages/ClientPortal.tsx`、`src/pages/BankPortal.tsx`、`src/components/**`（全部业务组件文案）。
**构建验证：** `npx vite build` 通过（3606 modules）。

### 16.1 品牌名与标识

| 项 | 旧 | 新 |
|---|---|---|
| 英文名 | `CipherBridge` | `FinLens` |
| 中文名 | （无） | `融鉴` |
| Slogan | （无） | `看清风险，不看隐私。` |
| 页签标题 | `CipherBridge` | `融鉴 FinLens · 看清风险，不看隐私` |
| 图标 | `/logo.png`（资源缺失，破图） | `/logo.svg`（新增矢量标识） |
| `lang` | `en` | `zh-CN` |

**Logo 构成（`public/logo.svg`，矢量稿来自 `icon_vector.svg`）：** `viewBox 0 0 173 148`。上下两条紫色渐变缎带（上 `#3020A6 → #6550DD → #A18CEB`，下 `#3524AA → #6852DE → #A08BEA`）构成**开口朝右的「C」形透镜**（右侧为平切端口，左侧收成尖），C 的开口处嵌入渐变菱形棱镜（`#6547D9 → #625EE4 → #35D5DE`，由紫转青）。顶栏采用「图标 + 融鉴/FinLens 文字锁定」组合。

> 注：设计稿中「设计思路 / DESIGN CONCEPT」下的三个小框（镜头·观察 / 棱镜·提炼 / 融汇成「鉴」）是 **Logo 设计概念说明**，不是网站首页的组成部分，故未放入首页。

### 16.2 品牌色板（`:root` 变量）

| Token | 旧值（M3 紫） | 新值（品牌） | 说明 |
|---|---|---|---|
| `--primary-color` | `#6750A4` | `#5B3CC4` | 品牌主紫（取自 Logo 深紫） |
| `--primary-light` | `#EADDFF` | `#EDE8FC` | 浅紫容器色 |
| `--primary-dark` | `#21005D` | `#1E1650` | 深紫 / 藏青（Logo 文字色） |
| `--accent-color` | — | `#45D6EE` | 棱镜青（新增） |
| `--bg-color` | `#FFFBFE` | `#F7F6FC` | 浅紫白背景 |
| `--text-primary` | `#1C1B1F` | `#1A1740` | 主文字（藏青） |
| `--text-secondary` | `#49454F` | `#514D6B` | 次文字 |
| `--border-color` | `#CAC4D0` | `#E4E0F5` | 浅紫边框 |
| `--m3-primary-rgb` | `103,80,164` | `91,60,196` | 透明光晕基色 |
| `--primary-hover` | — | `#6E4FE0` | 主按钮 hover（新增，避免白字不可见） |
| `--primary-soft` | — | `#C9BCF0` | 输入框 hover 边框（新增） |
| `--brand-gradient` | — | `linear-gradient(135deg,#7A5AF8,#4B2FB8)` | 主按钮 / 标题渐变 |
| `--brand-gradient-accent` | — | `linear-gradient(135deg,#5568E8,#45D6EE)` | 棱镜青渐变 |

- antd `colorPrimary` `#6750A4 → #5B3CC4`、`colorText → #1A1740`、`colorBorder → #E4E0F5`。
- 主按钮背景由纯色改为 `--brand-gradient`；表格表头底色 `#E7E0EC → --primary-light`。
- 中文字体栈：`'Inter','PingFang SC','Microsoft YaHei',-apple-system,…`。

### 16.3 首页改版（`src/pages/Home.tsx`）

按设计稿重构为营销首页：

| 区块 | 内容 |
|---|---|
| Hero（左） | 大标题「看清风险，/ 不看隐私。」（后半句品牌紫渐变）、副标题「用隐私计算技术，为中小企业构建更公平、更安全的融资环境。」、`开始体验 →`（→ `/client`）与 `银行端入口`（→ `/bank`）两个按钮 |
| Hero 背景 | 嵌入设计稿场景图 `src/assets/hero-bg.png`（`object-cover` 满幅，**透明无白色遮罩**），底部仅保留 64px 渐隐过渡到页面底色 |
| Hero（右） | 无边框/无底板，直接以白色文字（带柔和投影）叠加在画面右侧深色墙面上：「数据有界 / 信任无界 / 让更多可能发生」+ `MORE POSSIBILITIES FOR SMES`（移动端因背景较亮改用深色文字） |
| 顶栏 Header | 背景改为**透明**（移除白底 / 下边框 / 阴影）；首页 Hero 通过 `-mt-16 pt-16` 延伸到顶栏之后，顶栏内容以 `position:relative;z-index:20` 叠加在背景图之上，无接缝 |
| 入口卡片 | 客户端 / 银行端两张卡片（原 Portal 入口保留，品牌化配色） |
| 页脚 | Logo + `融鉴 FinLens` + `PRIVACY-PRESERVING RISK CONTROL FOR SMES` |

背景加入两枚品牌色径向光斑（`#7A5AF8`/`#45D6EE` 低透明度模糊）。

### 16.4 全站中文化

- 顶栏导航按设计稿为 `产品 / 解决方案 / 关于我们`（居中）+ `申请试用`（圆角主按钮 → `/client`）；`产品`→`/client`、`解决方案`→`/bank`、`关于我们`→首页页脚 `#about`。首页 Hero 标题「看清风险，不看隐私。」统一为藏青色。
- 所有页面与业务组件（客户端注册、任务管理、新建业务任务、银行注册、业务任务、数据加密、客户端/银行账户弹窗）的标题、按钮、表单标签、占位符、状态、提示消息、PDF 证明文案全部译为中文。
- 子页返回按钮 `Back to Home → 返回首页`。
- 接入 antd 中文语言包：`ConfigProvider locale={zhCN}`（`antd/locale/zh_CN`），空表格显示「暂无数据」等。
- 保留英文的位置：合约 revert 字符串匹配（`error.message.includes('Invalid user')` 等，必须与 Solidity 一致）、`console.*` 调试日志、代码标识符。

### 16.5 验证

| 检查项 | 结果 |
|---|---|
| `npx vite build` | ✅ 通过 |
| 控制台错误 | ✅ 0 error |
| `scripts/mobileCheck.cjs`（320/375/390/414/768） | ✅ 首页 / 客户端 / 银行端均无水平溢出 |
| Playwright 视觉确认 | ✅ 首页 Hero/设计思路/入口卡、顶栏中文化、钱包弹窗、银行/客户端页、移动端布局 |

> 说明：本仓库 `tsconfig.json` 仍缺失，`npm run build` 的 `tsc` 步骤会失败，故构建统一使用 `npx vite build`。
