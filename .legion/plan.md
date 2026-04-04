# mini-auth 单页 Demo / Docs 执行契约

## 任务

- 按 `docs/superpowers/specs/2026-04-04-single-page-demo-docs-design.md` 与 `docs/superpowers/plans/2026-04-04-single-page-demo-docs.md` 实现 mini-auth 的单页 Demo / Docs 页面。

## 验收

- `demo/` 升级为单页长文站点，同时承担 landing page、交互 demo、接入说明、API Reference、Backend JWT Integration 与部署说明。
- 页面继续从 `window.location.origin` 推导推荐的 `--origin`，并只接受 `?sdk-origin=` 作为外部配置参数。
- 页面中的命令、snippet、JWT 示例、API 示例与 playground runtime 共享同一份派生状态。
- Playground 继续支持 email start / verify、passkey register / authenticate、logout / session 可视化。
- 页面支持 GitHub Pages 子路径等非根路径静态部署；本地资源引用不依赖站点根路径。
- SDK 加载失败、CORS 配置错误、WebAuthn 环境不满足时，文档区仍可用且错误原因清晰可见。
- README 补充对单页 demo/docs 与静态部署说明的入口。
- 分段提交，并在全部验证完成后 push。

## 设计索引

- Spec: `docs/superpowers/specs/2026-04-04-single-page-demo-docs-design.md`
- Plan: `docs/superpowers/plans/2026-04-04-single-page-demo-docs.md`

## 阶段

1. Setup / Content：统一配置派生、内容构建、文案合同与测试
2. Page / Runtime：长页面结构、render / bootstrap、失败降级、URL 同步
3. Docs / Verify：README、部署说明、完整验证、push
