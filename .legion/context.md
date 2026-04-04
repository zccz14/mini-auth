# Context

## Progress

- 2026-04-04: 用户批准 `docs/superpowers/specs/2026-04-04-single-page-demo-docs-design.md` 与 `docs/superpowers/plans/2026-04-04-single-page-demo-docs.md`，要求直接执行，不使用 worktree，采用 LegionMind multi-agent，边做边提交，全部完成后再 push。
- 2026-04-04: 主上下文仅做 orchestration / review / `.legion` 写回；实现、测试、提交按 plan task 顺序交给 fresh subagent 执行。
- 2026-04-04: 已完成本轮 brainstorming、中文 spec、implementation plan，并得到用户批准开始执行。
- 2026-04-04: 用户要求使用 legionmind multi-agent 执行，不使用 worktree，边做边提交，完成后 push。
- 2026-04-04: 当前仓库有未跟踪设计/计划文档：`docs/superpowers/specs/2026-04-03-auth-server-cors-sdk-demo-design.md` 与 `docs/superpowers/plans/2026-04-03-auth-server-cors-sdk-demo.md`，需要纳入执行过程。
- 2026-04-04: 执行顺序按 plan 切为三段：Server CORS、SDK endpoint 契约、Demo/README/最终验证。
- 2026-04-04: 已提交 design/plan 文档：`cf36bb9 docs: add cors sdk demo design and plan`。
- 2026-04-04: Task 1 已完成并提交：`82d091c feat: add auth server cors responses`；该切片补齐了全局 CORS middleware、allowed/disallowed origin、preflight、error-path 与 `Vary: Origin` 行为。
- 2026-04-04: Task 2 已完成并提交：`3470131 test: cover sdk endpoint cors contract`；该切片为 `/sdk/singleton-iife.js` 补上了 allowed-origin CORS 测试，并去掉了 served source 里的 same-origin 限制文案。
- 2026-04-04: Task 3 已完成并提交：`e4c0626 feat: update demo for direct cors usage`；该切片移除了 proxy 文案，setup 继续从 `window.location.origin` 推导 Auth Server `--origin`，并允许通过 `?sdk-origin=` 覆盖默认 SDK origin。
- 2026-04-04: Task 4 已完成最终实现与验证；README 已更新 cross-origin 浏览器接入说明，demo 启动命令现在会根据实际 SDK URL 渲染具体 `--issuer`，并将 passkey 限制与 CORS allowlist 提示拆开。
- 2026-04-04: 已完成最终全量验证：`npm test && npm run typecheck && npm run lint && npm run build`，结果为 21 个 test files / 148 个 tests 全通过，typecheck/lint/build 全成功。

## Decisions

- 继续使用 `.legion/` 作为主控上下文，subagent 不直接写回 `.legion` 三文件。
- 不使用 worktree；所有实现在当前工作区进行。
- 浏览器拓扑保持 `script-origin == api-origin`，CORS allowlist 与 WebAuthn origin 校验统一复用 `--origin`。
- 单页 demo/docs 执行遵循 `docs/superpowers/plans/2026-04-04-single-page-demo-docs.md`，按 Task 0-6 顺序推进，每个 task 完成后做 review 再进入下一项。

## Next

- 先提交本轮 single-page demo/docs 的 spec / plan 文档。
- 然后依次执行 Task 1-6，并在全部验证完成后 push 当前分支。
