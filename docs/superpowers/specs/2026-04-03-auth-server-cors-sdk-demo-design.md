# Auth Server CORS 扩展（SDK 与 Demo）设计

## 背景

- 当前服务端已经通过 `GET /sdk/singleton-iife.js` 提供浏览器 SDK，且 SDK 会从脚本 `src` 推导自己的 API base URL。
- 当前 SDK 与 `README.md` 明确把浏览器集成限定为 same-origin 或 same-origin proxy。
- 当前 demo 假定存在 proxy，并默认用 `/api/sdk/singleton-iife.js` 作为 SDK 地址。
- Auth Server 已经存在必填的 `--origin` 运行时合同，用于 WebAuthn 的 origin 校验。
- 这次目标是在不引入第二套 allowlist、也不改变 SDK 零配置单例合同的前提下，为浏览器跨域使用补齐 CORS 能力。

## 目标

- 允许部署在不同 origin 的浏览器页面加载 Auth Server 提供的 SDK，并成功调用 Auth API。
- 保持浏览器 SDK 的核心合同不变：脚本来自哪个 Auth Server，API 就打到哪个 Auth Server。
- 保持 Auth Server 的 `--origin` 作为唯一的浏览器来源白名单。
- 让 demo 可以直接由静态文件服务器启动，不再依赖反向代理。
- 保证 Auth Server 所有面向浏览器的 API 响应都带有正确且一致的 CORS 头。

## 非目标

- 不新增独立于 `--origin` 的 CORS 配置项。
- 不给 singleton browser SDK 增加 runtime `configure()` 或显式 base URL override。
- 不把当前浏览器鉴权模型从 bearer token 切换到 cookie / credentialed CORS。
- 不支持“脚本 origin 与 API origin 分离”的拓扑。
- 不改变现有 email auth、session refresh/logout、`/me`、JWKS、WebAuthn 的业务语义。

## 设计决策

采用一种固定拓扑来支持跨域浏览器页面：页面本身可以在另一个 origin 上，但 SDK 脚本与 API 必须继续来自同一个 Auth Server origin。Auth Server 只对 `Origin` 命中 `--origin` 配置的浏览器请求返回 CORS 允许头；demo 与文档则从“必须 same-origin proxy”切换为“允许直接跨域接入”。

## 为什么选这个方向

- 它保留了当前 SDK 的心智模型：页面只要加载一个脚本，SDK 就天然指向提供该脚本的 Auth Server。
- 它避免了配置漂移：`--origin` 同时约束 WebAuthn 与 CORS，不会出现两套浏览器来源规则。
- 它满足了 demo 直接跨域运行的目标，同时避免为此引入第二种 SDK 部署模式。
- 它不需要把 cookie、credentials 或脚本/API 分离拓扑混入当前设计。

## 部署拓扑

### 支持的浏览器拓扑

- 页面 origin：例如 `http://127.0.0.1:8080`
- Auth Server origin：例如 `http://127.0.0.1:7777`
- SDK 脚本：`http://127.0.0.1:7777/sdk/singleton-iife.js`
- SDK 推导出的 API base URL：`http://127.0.0.1:7777`
- Auth Server 启动参数：`mini-auth start ... --origin http://127.0.0.1:8080`

### 明确合同

- 支持 cross-origin 页面。
- SDK 脚本与 HTTP API 必须共享同一个 Auth Server origin。
- 页面 origin 必须出现在 Auth Server 的 `--origin` 列表中。
- same-origin proxy 仍然是合法部署方式，但不再是唯一文档化的浏览器接入方式。

## Server CORS 合同

### 唯一来源

- `--origin` 继续作为唯一的浏览器来源 allowlist。
- 同一份 origin 列表同时用于：
  - WebAuthn origin 校验
  - HTTP CORS allow 决策

### 覆盖范围

- 所有面向浏览器的 Auth Server 路由都必须参与同一套 CORS 合同。
- 包括：
  - `GET /sdk/singleton-iife.js`
  - `POST /email/start`
  - `POST /email/verify`
  - `GET /me`
  - `POST /session/refresh`
  - `POST /session/logout`
  - `POST /webauthn/register/options`
  - `POST /webauthn/register/verify`
  - `POST /webauthn/authenticate/options`
  - `POST /webauthn/authenticate/verify`
  - `DELETE /webauthn/credentials/:id`
  - `GET /jwks`

### 正常响应行为

- 对任何带 `Origin` 请求头、且该值命中 `--origin` 配置的请求，服务端返回：
  - `Access-Control-Allow-Origin: <request-origin>`
  - `Vary: Origin`
- 服务端不返回 `Access-Control-Allow-Credentials`。
- Bearer token 模型保持不变，继续通过 `Authorization` 请求头发送认证信息。
- 对不带 `Origin` 的请求，仍按普通非浏览器或同源请求处理，不强行进入 CORS 分支。

### Preflight 行为

- 服务端在全局层统一处理 `OPTIONS` preflight，而不是每条路由单独实现。
- 对允许的 origin，preflight 响应至少返回：
  - `Access-Control-Allow-Origin: <request-origin>`
  - `Access-Control-Allow-Methods: GET, POST, DELETE, OPTIONS`
  - `Access-Control-Allow-Headers: Authorization, Content-Type`
  - `Vary: Origin`
- preflight 应在不进入业务逻辑的前提下成功返回。
- 对不允许的 origin，preflight 不得返回 `Access-Control-Allow-Origin` 或其他 allow 头，避免误放宽浏览器合同。

### 不允许的 origin

- 如果请求里的 `Origin` 不在 `--origin` 列表内，服务端不返回 `Access-Control-Allow-Origin`。
- 对非浏览器调用方，路由业务逻辑仍可照常运行；是否被拦截由浏览器自身负责。

## SDK 行为

### Base URL 推导

- 保持当前零配置 singleton 行为。
- `window.MiniAuth` 继续从 SDK script URL 推导 API base URL。
- 不引入 runtime override，也不新增 `configure()`。

### 浏览器合同

- 当页面 origin 被 `--origin` 允许时，支持 cross-origin 浏览器接入。
- SDK 脚本与 API 仍然绑定到同一个 Auth Server origin。
- SDK 继续使用 `Authorization` 请求头发起鉴权请求，因此 preflight 覆盖是必需且符合预期的。

### 不支持的拓扑

- 本设计明确不支持“脚本从一个 origin 加载，但 API 请求发往另一个 origin”的模式。
- 如果未来需要该能力，应作为一份新的 SDK 合同单独设计，而不是在当前 singleton endpoint 上叠加。

## Demo 行为

### 启动模型

- Demo 不再假定或推荐使用反向代理。
- Demo 可以直接由普通静态文件服务器运行，例如 `live-server`。
- 文档不需要说明如何启动静态文件服务器。

### 环境推导

- Demo 直接从当前文档地址读取页面位置，并统一规范到 `window.location.origin`。
- 当前页面 origin，而不是完整页面 URL，会被用作推荐的 Auth Server `--origin` 值。
- Demo 需要展示如何启动 Auth Server，使其接受当前页面作为允许的浏览器来源。

### Demo 展示的信息

- 展示当前页面 origin。
- 展示推导出的 RP ID 与所需的 `--origin` 值。
- 展示推荐的 `mini-auth start ... --origin <current-page-origin>` 命令。
- 不再展示 proxy 命令。
- 不再展示如何启动 demo 静态服务器。

## 文档更新

- 更新 `README.md` 中的 Browser SDK 章节。
- 把当前“same-origin only”的表述替换为新的合同：
  - 支持 cross-origin 页面
  - 页面 origin 必须出现在 `--origin` 列表中
  - SDK 脚本与 API 仍然来自同一个 Auth Server origin
- 增加一个 cross-origin 示例，展示页面 origin 与 Auth Server origin 位于不同端口或不同域名的情况。
- same-origin proxy 部署仍可保留为允许的选项，但不再作为主路径。
- 更新 demo 相关说明，让 Auth Server 启动命令直接从当前页面 origin 推导，而不是围绕 proxy path 展开。

## 错误处理

- CORS 处理必须覆盖错误响应，而不只是成功响应。
- 只要请求 origin 是允许的，浏览器就应在认证错误、校验错误与成功响应中都收到一致的 CORS 头。
- 这样可以避免“服务端其实返回了 JSON 错误，但浏览器只暴露成 CORS 失败”的混淆现象。

## 测试策略

必须覆盖以下内容：

- 允许的 origin 在正常 API 响应上收到 `Access-Control-Allow-Origin`
- 不允许的 origin 不会收到 `Access-Control-Allow-Origin`
- 允许的 origin 响应包含 `Vary: Origin`
- 允许的 origin 上，全局 `OPTIONS` preflight 成功
- preflight 宣告 `GET, POST, DELETE, OPTIONS`
- preflight 宣告 `Authorization` 与 `Content-Type`
- `GET /sdk/singleton-iife.js` 也返回预期的 CORS 头
- 错误响应在允许的 origin 下仍带有预期 CORS 头
- demo setup 文案从 `window.location.origin` 推导推荐的 `--origin`
- 不允许的 origin 的 `OPTIONS` 请求不会收到 allow 头
- README 示例与 demo 文案反映“直接跨域使用，无需强制 proxy”

由于 SDK 的 base URL 推导合同本次不变，因此不需要为其新增第二种 base URL 模式测试。

## 风险与缓解

### 风险：CORS 与 WebAuthn origin 规则发生漂移

- 缓解：两者共用同一个 `--origin` 列表，并在文档中明确这是同一份合同。

### 风险：只有成功响应带 CORS 头，错误响应漏掉

- 缓解：在 app middleware / error boundary 层统一施加 CORS，而不是仅在 route handler 成功分支设置。

### 风险：demo 仍残留 proxy 导向文案

- 缓解：移除 proxy 相关提示，并直接根据运行中的页面位置生成 Auth Server 启动建议。

### 风险：用户误以为 cross-origin 也意味着脚本 origin 与 API origin 可以分离

- 缓解：在文档中重复强调支持的拓扑：页面可以跨域，但 SDK 仍始终请求提供该脚本的 Auth Server。

## 验收标准

- 部署在 `--origin` 列表中的页面 origin，可以跨域加载 Auth Server 的 `GET /sdk/singleton-iife.js` 并成功使用 SDK。
- Auth Server 仅使用 `--origin` 作为浏览器 CORS allow 决策的来源。
- 所有面向浏览器的 Auth 路由，包括 SDK asset endpoint，都为允许的 origin 返回正确 CORS 头。
- 当前 bearer-token 请求模型下所需的浏览器 preflight 可以成功通过。
- 对允许的 origin，错误响应也带有预期的 CORS 头。
- Singleton browser SDK 仍保持零配置，并继续从 script URL 推导自己的 API base URL。
- Demo 不再依赖 proxy，并从 `window.location.origin` 推导推荐的 Auth Server `--origin`。
- README 与 demo 指引把“直接跨域使用”作为主路径，而不是要求 same-origin proxy。
