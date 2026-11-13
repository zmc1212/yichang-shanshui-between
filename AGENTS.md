# 项目规则：宜昌 · 江山之间

## 原站与本地仓库

- 本仓库源自原生 Sites 项目 `appgprj_6af0b8d6dbec81919ea6c30c51e88270` 的 V78；原站源码提交为 `bb919a6ade05f03f7f3150aae703b45c48cd5bd4`。不要把这个历史基线当作以后修改原站时的最新版本。
- 本地开发与原站隔离。保留 `.openai/hosting.json` 作为来源配置；不得向原 Sites 源仓库推送，不得保存、发布、覆盖、回退或更改原站，除非用户另行明确授权。
- 保持源码、城市数据、现有模型、贴图和引用。GIS、模型来源和配准边界见 `public/data/sources.txt`、`docs/export-model-inventory.json` 和 `docs/models/`；不要用简单方块或新制作的相似模型替代已有资产。

## 启动与验证

- 安装：`npm ci`；开发：`npm run dev -- --host 127.0.0.1 --port 4173`；生产构建：`npm run build`。需通过本地 HTTP 服务访问，不能直接双击 `index.html` 使用 `file://`。
- 资源清点：`node scripts/audit-export-models.mjs`；该脚本解析模型几何、检查资源引用并更新 `docs/export-model-inventory.json`。模型与贴图的技术检查不能替代人工视觉验收。
- 用户于 2026-11-13 指定：迁移后只需检查界面能正常打开；最终三维渲染效果由用户肉眼检查。不要为最终画面自动化截图、视觉比对或代替用户做渲染效果验收，除非用户之后明确要求。
- 原始 V78 中部分既有检查失败，详情见 `docs/export-handoff.md`；不得仅为消除失败而修改断言或改变原场景。
- 不要提交 `.env`、令牌、Cookie 或其他凭据；模型采用 Git LFS，克隆后先运行 `git lfs pull`。
