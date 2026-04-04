# mini-auth 单页 Demo / Docs 站点设计

## 背景

- 当前仓库已经有 `demo/` 静态调试页，支持通过 `?sdk-origin=` 指向任意 Auth Server，并根据 `window.location.origin` 生成推荐的 `--origin` 启动参数。
- 当前 demo 更像手工测试控制台，适合开发者本地验证，但还不足以直接承担对外展示、接入引导、API Reference 与后端集成文档的职责。
- 项目现有文档主要集中在 `README.md`，随着 Browser SDK、cross-origin、JWT 对接等内容增加，README 会继续变长。
- 用户希望把 demo 推进成一个长页面，同时兼具 demo 与文档，不拆成多页站点，并可托管在 GitHub Pages 或任意静态宿主上。
- 页面运行时不应强行绑定某个固定域名；无论部署到哪里，都应继续从当前 document origin 推导接入指引。

## 目标

- 产出一个单页长文页面，同时承担 landing page、交互 demo、接入指南、API Reference 与后端 JWT 集成文档。
- 保持 mini-auth 的产品定位：简单、直接、低配置；文档结构也应体现“看一页就能接起来”。
- 页面运行时继续基于 `window.location.origin` 生成推荐的 `--origin`，不把 `mini-auth.zccz14.com` 或任何其它域名写死为产品合同。
- 页面允许访问者填入自己的 `sdk-origin`，并立即在同页完成接入验证。
- 为后端消费者提供推荐的 JWT 验签路径，主推 `jose` 作为对接库。
- 让 GitHub Pages 成为默认静态部署路径之一，但不把部署平台耦合进页面业务逻辑。

## 非目标

- 不新增一个固定公共 Auth Server 作为 demo 默认后端。
- 不把内容拆成多页面文档站或引入复杂站点生成器。
- 不改变 singleton browser SDK 的核心合同：script origin 继续等于 API origin。
- 不把当前 SDK 的多 tab 刷新竞争问题写成正式产品限制；它属于已知 bug，不作为长期合同固化。
- 不在本次设计中重做 SDK 会话模型、JWT 结构，或新增专用后端 SDK。

## 设计决策

采用一个静态、单页、长文结构的站点来承载 mini-auth 的对外体验。页面既是文档，也是可交互的真实接入环境：访问者先读最短接入说明，再填写自己的 Auth Server 地址，然后直接在同页完成 email OTP、passkey、session 和 JWT 对接验证。页面的所有动态文案、命令与代码片段都围绕当前页面 origin 与用户输入的 Auth Server 配置联动生成。

## 为什么选这个方向

- 它符合 mini-auth 的产品哲学：如果核心能力本来就简单，文档不应膨胀成必须跨页导航的大站。
- 它复用已有 demo 的运行模型，而不是重新设计另一套“官网”和另一套“测试页”。
- 它让“文档”和“真实可运行示例”共享同一份配置状态，避免文档与 demo 漂移。
- 它天然适合 GitHub Pages 这类静态托管，也保留将来迁移到任意静态宿主的自由度。

## 页面定位

### 单页角色

- 页面是 mini-auth 的主入口之一。
- 页面同时承担四种职责：
  - 项目介绍
  - 浏览器接入与配置说明
  - 交互式 demo
  - API / JWT 集成参考

### 页面合同

- 页面不绑定固定线上 Auth Server。
- 页面不依赖反向代理作为主路径。
- 页面读取自身 `window.location.origin`，并据此生成：
  - 推荐的 `--origin`
  - 与当前页面部署环境一致的说明文案
- 页面允许用户输入或覆盖自己的 `sdk-origin`，并让全页内容同步更新。

## 信息架构

### 1. Hero

- 用一句话解释 mini-auth：一个小而清晰的 Auth Server。
- 展示核心能力：email OTP、passkey、JWT、JWKS、SQLite、自托管。
- 强调目标用户：只想把 auth 跑起来，而不是引入整个平台。

### 2. Quick Start

- 给出最短的启动命令。
- 命令中的 `--origin` 由当前页面 origin 自动生成。
- `--issuer` 默认直接使用当前输入的 `sdk-origin`。
- 文案强调：页面部署到任何静态域名都可以，关键是把那个页面 origin 填进 mini-auth 的 `--origin`。

### 3. Integration Playground

- 让访问者输入自己的 `sdk-origin`。
- 页面 origin 只用于生成推荐的 `--origin`，不用于推导 SDK 脚本地址。
- Playground 必须从用户配置的 `sdk-origin` 派生 SDK script URL：`<sdk-origin>/sdk/singleton-iife.js`。
- 页面绝不能从文档站点自身的相对路径或绝对路径（如 `/sdk/singleton-iife.js`）加载 SDK，否则会破坏现有 `script-origin == api-origin` 合同。
- 页面通过该派生出的 SDK URL 动态加载脚本，并直接通过 `window.MiniAuth` 跑真实流程。
- 至少保留现有交互能力：
  - `POST /email/start`
  - `POST /email/verify`
  - passkey 注册
  - passkey 登录
  - session/logout 状态展示
- 将当前 demo 的“手工测试控制台”语气升级为“接入 playground”，但保留真实网络请求与真实浏览器能力验证。

### 4. How It Works

- 用简洁文案解释 mini-auth 的浏览器合同：
  - 页面可以跨域
  - SDK script origin 必须等于 Auth API origin
  - 页面 origin 必须出现在 mini-auth 的 `--origin` 中
- 解释为什么页面会推荐一个 `--origin` 值，以及它与 WebAuthn / CORS 的关系。
- 明确 GitHub Pages、自定义域名、localhost 只是不同托管 origin，不改变产品合同。

### 5. API Reference

- 提供精简但可直接使用的 API 参考。
- 覆盖最常见接口：
  - `POST /email/start`
  - `POST /email/verify`
  - `POST /session/refresh`
  - `GET /me`
  - `POST /session/logout`
  - `POST /webauthn/register/options`
  - `POST /webauthn/register/verify`
  - `POST /webauthn/authenticate/options`
  - `POST /webauthn/authenticate/verify`
  - `GET /jwks`
- 每个接口保持固定结构：
  - 做什么
  - 最小请求示例
  - 最小响应示例或典型字段示例
  - 在典型接入流程中何时调用
- API Reference 只承诺最小可用字段与典型调用方式，不把完整响应 JSON 固化成长期稳定合同；更完整字段以真实接口返回为准。

### 6. Backend JWT Integration

- 增加“后端如何消费 mini-auth access token”的专门章节。
- 主推使用 `jose`，而不是手写 JWKS 下载与密钥选择逻辑。
- 给出 Node / TypeScript 的最短可用示例：
  - 使用 `createRemoteJWKSet(new URL('/jwks', issuer))`
  - 使用 `jwtVerify(token, jwks, { issuer: '<issuer>' })`
- 文档明确：
  - 后端主路径是本地验 JWT，而不是每次请求都回源 mini-auth
  - 访问者应校验 `iss`
  - `aud` 是否校验取决于使用方服务边界，但页面要说明推荐做法
  - `GET /me` 更适合前端拉取当前用户态，而不是后端 API 的每次鉴权手段

### 7. Notes / Known Issues

- 只写真正影响接入理解的注意事项。
- 包括：
  - passkey 依赖合法 RP ID 与浏览器环境
  - cross-origin 页面必须加入 `--origin`
  - 当前 SDK 存在多 tab 会话竞争 bug：多个标签页同时刷新 session 时可能出现状态抖动或互相覆盖；当前建议避免把多个标签页当作稳定并发会话场景，但这不是正式产品限制，后续应修复

## 配置与状态模型

### 单一页面配置源

- 页面维护一份统一的配置状态，而不是让文档示例、命令行示例、demo runtime 分别持有不同来源。
- 最少包括：
  - 当前页面 origin
  - `sdk-origin`
  - 派生出的 SDK script URL
  - 推荐的 `--origin`
  - 推荐的 `--rp-id`

### 输入合同

- `sdk-origin` 必须是绝对 origin：`scheme + host + optional port`，不允许 path、query、hash。
- 页面在写入状态前需要对 `sdk-origin` 做规范化，确保后续派生结果稳定，例如去掉多余尾部斜杠。
- 本页不提供单独的 `issuer` 输入；页面上的 `issuer` 文案、命令和 JWT 示例统一直接使用当前的 `sdk-origin`。
- 当输入不满足合法 URL / origin 合同时，页面应阻止进入可运行状态，并给出明确错误提示。

### RP ID 推导合同

- 推荐的 `--rp-id` 不能从页面 origin 推导。
- `--rp-id` 只从 Auth Server 对应的 host 推导，唯一来源是 `sdk-origin`。
- 本设计默认使用 `sdk-origin` 的 host 作为推荐 `--rp-id`，因为 SDK script 与 API origin 合同固定绑定到 Auth Server origin。
- 推荐的 `--rp-id` 默认直接取 `new URL(sdkOrigin).hostname`。
- 页面不尝试做 eTLD+1、父域回退、子域裁剪或任何其它启发式推导。
- 若该值不符合部署者预期，页面只提示用户在实际部署 mini-auth 时手动确认 `--rp-id`，不再自动猜测其它值，也不提供独立的页面配置入口。

### 联动原则

- 当用户修改 `sdk-origin` 时，下列内容必须同步更新：
  - Quick Start 启动命令
  - SDK `<script>` 引入示例
  - API 示例中的 base URL 提示
  - JWT `jose` 示例中的 issuer / JWKS URL
  - playground 实际运行使用的 SDK 地址

### URL 参数

- 允许继续用 URL 参数预填配置，便于分享具体示例链接。
- 当前已存在的 `?sdk-origin=` 合同保留。
- `?sdk-origin=` 是本页唯一支持的外部配置参数。
- 不支持 `issuer=`、`jwks=`、`rp-id=` 或其它派生值参数；这些值必须统一从 `sdk-origin` 与 `window.location.origin` 派生，避免页面出现第二个配置权威来源。

### JWT 文档派生规则

- JWT 集成章节中的 `issuer`、`/jwks` 地址和 `jose` 示例必须从同一份页面配置状态派生。
- 页面统一使用 `sdk-origin` 作为 issuer。
- `jose` 示例中的 `issuer` 校验值使用 `sdk-origin`，JWKS 地址使用 `new URL('/jwks', sdkOrigin)` 规则派生。
- 页面不得通过字符串拼接或手工拼接斜杠来构造 JWKS URL，避免 path 与尾斜杠歧义。

## 运行与部署合同

### 静态部署

- 页面必须可作为纯静态资源部署。
- GitHub Pages 是推荐部署方式之一。
- 自定义域名是部署层选项，而不是页面业务假设。

### 路径兼容

- 页面应避免把资源路径写成只能在根路径部署时成立的形式。
- 需要兼容 GitHub Pages 项目路径与自定义域名根路径两类静态托管方式，避免脚本、样式或分享链接因路径前缀出错。

### 部署文档

- 仓库需要补充最小部署说明：
  - 如何发布 `demo/` 或构建产物到 GitHub Pages
  - 如使用自定义域名，如何配置 `CNAME`
  - 页面域名变化后，mini-auth 应如何设置新的 `--origin`

## 内容风格

- 文档文风应比当前手工测试页更产品化，但不应变成营销站。
- 文案重点是：短、准、可复制。
- API 与集成部分应以“最小可用路径”为先，把扩展解释收进折叠区块或附加说明，避免首屏信息过载。

## 与现有 README 的关系

- `README.md` 继续保留仓库级核心说明与 CLI 基本用法。
- 单页站点承接更完整的浏览器接入、API 参考与 JWT 集成文档。
- README 可以逐步加入指向该页面的链接，但不要求本次把 README 缩减到极小。
- 需要避免两份长文互相复制；详细浏览器接入内容以后以单页站点为准。

## 错误处理与降级

- 如果 SDK script 加载失败，页面仍应保留说明性内容与配置提示，而不是整页失效。
- 文档区块不依赖 SDK 成功加载才能渲染。
- playground 需要清晰显示当前失败原因，例如：
  - SDK URL 不可达
  - `--origin` 未配置导致 CORS 失败
  - 页面部署在不满足 WebAuthn 的环境下

## 测试策略

必须覆盖以下内容：

- 页面继续从 `window.location.origin` 推导推荐的 `--origin`
- 配置状态变更时，启动命令、script snippet、JWT `jose` 示例等文案同步更新
- `?sdk-origin=` 等分享参数能正确预填页面
- SDK 加载失败时，文档区仍可用，且错误提示清晰
- GitHub Pages 风格的非根路径部署下，静态资源路径仍正确
- API Reference 与 JWT 集成章节渲染出预期的关键字段和示例
- Known issue 文案把多 tab 竞争表述为 bug / current issue，而不是正式产品限制

## 风险与缓解

### 风险：单页内容失控，重新长成一份难读的大 README

- 缓解：严格按“Quick Start -> Playground -> Explanation -> Reference”的阅读顺序组织；默认展示最短路径，其它内容渐进展开。

### 风险：页面配置与 demo runtime 脱节

- 缓解：建立单一配置源，所有命令、代码片段和实际加载 URL 共用同一派生状态。

### 风险：静态部署路径不兼容 GitHub Pages

- 缓解：明确把路径兼容作为实现要求和测试项，而不是上线后再修。

### 风险：JWT 集成文档过于抽象，用户仍需自行摸索

- 缓解：主推 `jose`，提供最短可用代码，而不是只描述“去验证 JWKS”。

### 风险：已知 SDK bug 被误写成正式限制

- 缓解：在文案与测试中明确区分“产品合同”和“当前缺陷”，避免把多 tab 问题制度化。

## 验收标准

- 仓库产出一个单页长文 demo/docs 页面，能同时承担项目介绍、接入说明、交互 demo、API Reference 和 JWT 集成文档。
- 页面不绑定固定线上 Auth Server，仍从当前页面 origin 推导推荐的 `--origin`。
- 页面中的命令、代码片段、说明文字和 playground runtime 共享同一份配置状态。
- 页面明确推荐后端使用 `jose` 通过 `JWKS + jwtVerify` 集成 mini-auth access token。
- GitHub Pages 或其它静态托管只影响部署，不改变页面运行合同。
- 文档将多 tab 会话竞争问题表述为待修复 bug，而不是正式产品限制。
