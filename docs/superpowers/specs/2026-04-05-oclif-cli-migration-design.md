# oclif CLI 迁移设计

## 背景

- `auth-mini` 目前在 `src/index.ts` 中使用 `cac` 定义了 3 个命令：`create`、`start` 和 `rotate-jwks`。
- 现有 `src/cli/` 下的命令文件已经把大部分业务执行逻辑从参数解析里拆了出来，但它们的命名和位置仍然偏向 CLI 框架层。
- 当前 CLI 的报错体验不一致：参数错误或运行时错误有时只会表现为很简短的退出，对用户不够友好。
- 目前项目还没有明显的历史包袱或兼容压力，适合现在就切到更明确、更规范的 CLI 结构。

## 目标

- 将命令层从 `cac` 迁移到 `oclif`，并采用官方风格的命令目录结构。
- 改善默认 CLI 体验，包括命令发现、help 输出、usage 提示和非法输入反馈。
- 保持 `oclif` 命令适配层与应用执行层之间的清晰分离。
- 引入分层错误展示：默认输出简短且可执行的错误信息，`--verbose` 时再展示底层诊断细节。

## 非目标

- 不重构 auth server 的领域模型、运行时配置 schema 或 HTTP server 架构。
- 不顺带改造 `src/modules/`、`src/server/`、`src/infra/` 的无关代码。
- 不强行保留 `rotate-jwks` 作为唯一主命令形式；如果采用更符合 `oclif` 的命令结构，可以调整主命令名。

## 决策

- 采用 `oclif` 作为 CLI 框架，并使用标准的 `src/commands/` 目录做命令发现。
- 将当前以执行为主的 `src/cli/` 模块迁移到与框架无关的 `src/app/commands/`。
- `src/commands/` 保持足够薄：每个命令只定义 args、flags、描述、示例，并委托给对应的应用执行模块。
- 引入共享的 `BaseCommand`，集中处理一致的错误展示、`--verbose` 支持和退出码行为。
- 将 JWKS 轮转命令主路径调整为更符合 `oclif` 习惯的 `rotate jwks`，同时保留 `rotate-jwks` 作为一个版本周期内的已记录兼容 alias。

## 建议目录结构

- `src/commands/create.ts`
- `src/commands/start.ts`
- `src/commands/rotate/jwks.ts`
- `src/commands/base.ts`
- `src/app/commands/create.ts`
- `src/app/commands/start.ts`
- `src/app/commands/rotate-jwks.ts`

现有领域与基础设施模块保持原位：

- `src/shared/*`：共享配置解析、日志与通用工具
- `src/server/*`：HTTP app 组合
- `src/modules/*`：领域逻辑
- `src/infra/*`：数据库与 SMTP 等基础设施

## 打包与启动

- 用 `oclif` 入口替换当前手写的 `src/index.ts` `cac` 启动逻辑，由它负责加载编译后的 `dist/commands/` 命令。
- 已发布的二进制名称继续保持为 `auth-mini`。
- 更新 `package.json`，让发布时的 `bin` 指向编译后的 `oclif` 启动入口，而不是当前单文件 `cac` 启动文件。
- 增加 `oclif` 所需的包级配置，让命令发现以构建产物中的 `dist/commands/**/*` 为准。
- 首次迁移优先采用运行时命令发现，不额外引入自定义 manifest 生成链路，保证构建过程更直观。
- 构建产物仍然统一输出到 `dist/`，但内容应包含：
  - 一个编译后的 CLI 启动入口
  - `dist/commands/` 下的编译命令模块
  - `dist/app/commands/` 下的编译执行模块
- 打包验收标准：打出来的包或安装后的产物，必须能在脱离 TypeScript 源码目录的环境中成功执行 `auth-mini --help` 与 `auth-mini start --help`。

## 分层边界

- `src/commands/*`
  - 定义 `oclif` 的 args、flags、示例、摘要、aliases 与 help 文案
  - 将 CLI 解析结果转换为普通应用输入
  - 负责终端展示相关问题，例如 stderr 错误信息、usage hint、退出码
  - 负责 `--verbose` 下的诊断输出
- `src/app/commands/*`
  - 接收普通的强类型输入并编排应用运行行为
  - 不依赖 `oclif` 类或终端交互格式
  - 复用现有 `src/shared/*`、`src/server/*`、`src/modules/*`、`src/infra/*`
- `start` 生命周期约定
  - `src/app/commands/start.ts` 继续返回 `Promise<{close(): Promise<void>}>`
  - 命令适配层决定是否持续等待、如何接 process signal，以及如何向终端用户展示启动或关闭失败
  - CLI 运行时的 logger sink 注入仍放在应用命令边界，而不是渗透进领域模块

## 命令设计

### `create`

- 保留数据库路径位置参数。
- 保留 `--smtp-config <file>`。
- 通过 `oclif` metadata 改善 help 文案与示例。

### `start`

- 保留数据库路径位置参数，以及 `--host`、`--port`、`--issuer`、`--rp-id` 和可重复的 `--origin`。
- 通过基础命令类提供全局 `--verbose`。
- 保留当前的 `--origin` 归一化行为：单个 `--origin` 在进入语义校验前也会被视为单元素数组。
- 继续让语义校验集中在 `oclif` 之外：`oclif` 只负责把输入解析为基础类型和重复 flag 数组，应用层或共享配置层仍是运行时语义校验的单一事实来源。

### `rotate jwks`

- 采用更符合 `oclif` 习惯的 topic 风格命令命名。
- 保留 `rotate-jwks` 作为一个版本周期内的已记录兼容 alias，后续再在明确的 breaking change 中移除。

## 错误处理策略

- 未知命令、缺少必填参数、flag 解析错误等框架级 CLI 错误，交由 `oclif` 负责。
- 应用执行过程中抛出的异常，由共享 `BaseCommand` 捕获并格式化成用户可理解的错误输出。
- 终端 I/O 约定：
  - help、usage、version 输出到 stdout
  - 面向用户的命令错误输出到 stderr
  - 结构化应用日志继续保持独立的机器可读输出流，不和命令错误格式混在一起
  - `--verbose` 只扩展错误诊断细节，不悄悄改变结构化日志格式
- 默认错误输出应当简短且可行动：
  - 清晰的错误摘要
  - 如果能判断，给出一条简短的修复提示
  - 用户大概率需要 usage 时，附带 `--help` 指引
- `--verbose` 额外输出原始错误细节、因果链和 stack trace。
- 业务代码仍然可以抛普通错误；终端展示策略留在命令层，不把 CLI UX 细节下沉到领域模块。

默认错误输出示例：

```text
Error: invalid SMTP config file
Hint: ensure `--smtp-config` points to a readable JSON array file
See: auth-mini create --help
```

`--verbose` 补充示例：

```text
Cause: ENOENT: no such file or directory, open './smtp.json'
Stack:
...
```

## 设计理由

- 相比 `cac`，`oclif` 更适合作为“正式 CLI 产品框架”，而不只是一个开发者内部入口。
- 项目现在还足够早，尽早采用 `oclif` 习惯用法，比以后用户和命令更多时再迁移成本更低。
- 将 `src/commands/` 和 `src/app/commands/` 分开，可以让 CLI 框架保持可替换，也让命令执行逻辑更容易独立测试。
- 分层错误展示正好回应了本次迁移动机：当前“退出了但信息不清楚”的体验对最终用户很困惑。

## 风险

- 构建与发布集成需要调整，因为 `oclif` 的命令发现与运行时预期不同于当前单入口 `cac` 结构。
- help、version、命令不存在提示等输出都会变化，README 和用户习惯需要一起迁移。
- `--origin` 这类可重复 flag 的行为需要重点验证，确保新解析结果与 `parseRuntimeConfig()` 期望的运行时契约一致。
- 目前 CLI 在源码中写死的版本号已经和 `package.json` 不一致；迁移时必须消除重复版本来源，统一从打包元数据读取版本。

## 测试

- 增加命令层测试，直接覆盖新的 `oclif` 入口，并验证：
  - 缺少必填参数时的失败输出
  - 未知命令时的失败输出
  - 重复 `--origin` 的解析行为
  - help 与 version 输出
  - 默认错误输出与 `--verbose` 的差异
- 增加一个打包/构建烟测，验证的是构建或打包后的二进制，而不是只在源码层 import TypeScript 模块。
- 保留或迁移应用执行层测试，确保业务行为仍然可以脱离 CLI 框架独立验证。
- 验证顺序先跑定向 CLI 测试，再跑全量测试、typecheck、build 和 lint。

## 迁移清单

- 更新当前直接引用 `src/cli/*` 的 import，让测试和辅助代码按需要迁移到 `src/app/commands/*`。
- 替换任何直接执行旧单文件 CLI 启动入口的测试 helper，改为执行构建后的 `oclif` 二进制。
- 更新 README 命令示例，主文档使用 `rotate jwks`，并在兼容期说明 `rotate-jwks` 仍可用。
- 增加兼容性测试，确认 `rotate-jwks` 在过渡版本中仍会路由到同一套实现。
- 增加版本测试，证明 CLI 输出版本来自 `package.json` 元数据，而不是源码中的重复常量。

## 成功标准

- 发布产物已经使用 `oclif`，并从 `src/commands/` 对应的构建结果发现命令。
- `create`、`start`、`rotate jwks` 可以端到端正常工作。
- `rotate-jwks` 在过渡版本中继续作为已记录 alias 可用。
- 默认用户错误信息比当前 `cac` 体验更清晰。
- `--verbose` 能提供足够的底层诊断信息，同时不打扰普通用户。
- README 示例与 help 输出与新命令结构一致。
- 打包安装后的 `auth-mini --help` 可以成功执行。
