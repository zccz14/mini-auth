# Context

## Progress

- 2026-04-04: 已完成本轮 brainstorming、中文 spec、implementation plan，并得到用户批准开始执行。
- 2026-04-04: 用户要求使用 legionmind multi-agent 执行，不使用 worktree，边做边提交，完成后 push。
- 2026-04-04: 当前仓库有未跟踪设计/计划文档：`docs/superpowers/specs/2026-04-03-auth-server-cors-sdk-demo-design.md` 与 `docs/superpowers/plans/2026-04-03-auth-server-cors-sdk-demo.md`，需要纳入执行过程。
- 2026-04-04: 执行顺序按 plan 切为三段：Server CORS、SDK endpoint 契约、Demo/README/最终验证。

## Decisions

- 继续使用 `.legion/` 作为主控上下文，subagent 不直接写回 `.legion` 三文件。
- 不使用 worktree；所有实现在当前工作区进行。
- 浏览器拓扑保持 `script-origin == api-origin`，CORS allowlist 与 WebAuthn origin 校验统一复用 `--origin`。

## Next

- 先提交已批准的 design/plan 文档。
- 然后进入 Task 1：补 CORS 测试、实现 middleware/preflight/error-path，并完成第一轮提交。
