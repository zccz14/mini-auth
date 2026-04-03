# Auth Server CORS（SDK / Demo）执行契约

## 任务

- 按 `docs/superpowers/specs/2026-04-03-auth-server-cors-sdk-demo-design.md` 与 `docs/superpowers/plans/2026-04-03-auth-server-cors-sdk-demo.md` 实现 Auth Server 的 CORS 扩展，覆盖 SDK 与 Demo。

## 验收

- Auth Server 的所有浏览器可见 API（含 `GET /sdk/singleton-iife.js`）对允许的 `Origin` 返回正确 CORS 头
- `OPTIONS` preflight 在允许的 origin 下成功，在不允许的 origin 下不误放行
- CORS 合同与 `--origin` 保持唯一且一致的来源
- SDK 继续保持 `script-origin == api-origin` 与零配置 base URL 推导
- Demo 不再依赖 proxy，可直接静态启动并根据 `window.location.origin` 推导 Auth Server `--origin`
- README 完成 cross-origin 接入文档更新
- 分段提交并最终 push

## 设计索引

- Spec: `docs/superpowers/specs/2026-04-03-auth-server-cors-sdk-demo-design.md`
- Plan: `docs/superpowers/plans/2026-04-03-auth-server-cors-sdk-demo.md`

## 阶段

1. Server CORS：测试 / middleware / preflight / error-path
2. SDK endpoint：契约与测试更新
3. Demo / README / 最终验证 / push
