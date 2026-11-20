# MLflow UI 简体中文本地化（MLflow 3.18.0）

基于 MLflow 3.18.0 前端（`mlflow/server/js`）的简体中文本地化版本，作为 MLflow 前端源码的一个 fork 维护。

## 本地化范围

- 语言包：`src/lang/zh-CN.json`（源文件，按 formatjs 消息 id 组织），构建时经 `I18nCompileLoader` 编译为运行时 JSON。
- 规模：`yarn i18n` 提取 5268 条消息，最终中文语言包 5293 条（含 18 个显式 `admin.resourceType.*` id 与助手快捷提示词等手动补充项）。
- 覆盖区域：首页与侧边栏、实验/运行/模型/产物列表、Traces 与 Sessions、评估对比、管理页（用户/角色/权限）、MLflow Assistant 面板与欢迎轮播、分页与空状态、无障碍 aria 文案。
- 翻译规范：保留 MLflow、Databricks、API、SDK、Git、GPU、JSON、YAML、URL、token、prompt、trace、span 等产品名与技术名词；其余 UI 文案译为简体中文，ICU MessageFormat 占位符与 plural/select 结构原样保留。

## 使用方式

语言由 `localStorage.locale` 或 URL 参数 `?l=zh-CN` 决定，参见 `src/i18n/I18nUtils.ts`；运行时按语言动态加载 `src/lang/compiled/<locale>.json`（`src/i18n/loadMessages.ts`）。

## 构建

```bash
yarn install

# 1) 从源码提取英文消息（输出 src/lang/default/en.json）
yarn i18n

# 2) 合并/补齐中文翻译（脚本见 scripts/i18n-zh）
python3 scripts/i18n-zh/merge.py
node scripts/i18n-zh/validate_icu.js scripts/i18n-zh/zh-CN.merged.json
cp scripts/i18n-zh/zh-CN.merged.json src/lang/zh-CN.json

# 3) 应用 node_modules 中文补丁（重装依赖后需重新执行）
bash scripts/i18n-zh/apply-node-modules-patches.sh

# 4) 构建（如需强制刷新 webpack 缓存：rm -rf node_modules/.cache）
yarn build
```

产物在 `build/`，部署时覆盖 Python 包内的静态目录：

```bash
rsync -a --delete build/ <site-packages>/mlflow/server/js/build/
```

## node_modules 补丁说明

`scripts/i18n-zh/patches/` 中的补丁用于修正第三方组件库的硬编码英文：

| 补丁 | 作用 |
| --- | --- |
| `antd-locale-default.patch` | antd 默认 locale 切换为 `zh_CN` |
| `rc-pagination-en_US.patch` | 分页组件默认 locale 切换为中文 |
| `databricks-design-system.patch` | `CursorPagination` 的页码文案与 `Resize Column`、`Close alert` 等 aria 文案 |

注意：补丁作用于 `node_modules`，`yarn install` 后需重新执行 `apply-node-modules-patches.sh`，并清理 `node_modules/.cache` 后重建，否则 webpack 会复用旧模块缓存。

## 翻译流程脚本

`scripts/i18n-zh/`：

- `translate.py` / `translate_all.py`：调用 GLM 的 Anthropic 兼容接口批量翻译缺失文案（单线程 / 多线程，支持断点续跑，需要 `ANTHROPIC_BASE_URL`、`ANTHROPIC_API_KEY` 环境变量）。
- `merge.py`：以 `en.json` 的 key 全集为基准，合并旧翻译与新机器翻译，输出 `zh-CN.merged.json`。
- `validate_icu.js`：用 `@formatjs/icu-messageformat-parser` 校验 ICU 语法。
- `translations.json`：本次机器翻译记忆库（3531 条）。

## 已知限制

- 后端接口返回的错误消息（如 404 响应体）仍为英文，属于服务端文案，不在本次前端本地化范围内。
- `src/admin/DevUserSwitcher.tsx` 仅在 development 构建中显示，未做本地化。
- 第三方库升级后补丁可能失效，需要按新版文件重新生成。

## 许可证

本项目基于 MLflow（Apache License 2.0）修改，见 [LICENSE](LICENSE)。
