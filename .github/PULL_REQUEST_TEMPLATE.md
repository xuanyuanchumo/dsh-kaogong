## 变更类型

- [ ] `feat` 新功能
- [ ] `fix` 缺陷修复（关联 issue：______）
- [ ] `docs` 文档
- [ ] `refactor` / `perf` 重构或性能
- [ ] `test` 测试基建
- [ ] `cycle` 迭代闭环（含门禁工件）
- [ ] `release` 发布（仅 develop → main）

## 目标分支

- [ ] `feature/*` → `develop`（默认）
- [ ] `hotfix/*` → `main` + `develop`
- [ ] `develop` → `main`（release，squash）

## 变更摘要

<!-- 一句话说明为什么改；详述放正文 -->

## 验收清单（逐项勾选，不得删节）

- [ ] `npx tsc --noEmit` 通过
- [ ] `npm run build` 通过
- [ ] `npm run test:all` 全绿（smoke ____ / render ____）
- [ ] ANIC 评估 16 维 PASS + G0-G3 + HITL（若适用）
- [ ] 新端点已登记 `src/shared/manifest.ts`（method/path/label/consumers/desc 齐全）
- [ ] 新增测试使用独立 `PROJ_*` 命名空间（防跨段污染）
- [ ] 文档同步（API-REFERENCE / ROADMAP / CLAUDE.md / 研究文档）
- [ ] 提交信息符合 Conventional Commits（见 CONTRIBUTING.md）

## 破坏性变更 / 风险

<!-- 无则写「无」 -->

## 关联

Closes #______ / Refs #______
