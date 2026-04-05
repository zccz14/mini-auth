# oclif CLI 迁移 Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 `auth-mini` 的 CLI 从 `cac` 迁移到 `oclif` 官方风格结构，同时改善默认错误提示、保留应用执行层边界，并让构建与打包后的 CLI 可独立运行。

**Architecture:** 先用行为测试锁定新 CLI 契约，再抽离框架无关的执行层到 `src/app/commands/*`，之后同一批完成 `oclif` 启动入口、`package.json` 元数据、`dist/commands/*` 命令发现和真实 `npm pack` 烟测，避免把发布风险拖到最后。`start` 命令的信号处理、关闭幂等和退出行为单独以测试驱动实现。README 更新放在所有运行时验收通过之后。

**Tech Stack:** TypeScript, Node.js, oclif, @oclif/core, Vitest, ESLint, Prettier

---

## Chunk 1: 先锁定 CLI 行为契约

### Task 1: 为新 CLI 命令行为写失败测试

**Files:**

- Modify: `tests/integration/cli-create.test.ts`
- Modify: `tests/helpers/cli.ts`
- Create: `tests/integration/oclif-cli.test.ts`

- [ ] **Step 1: 写失败测试，锁定主命令、兼容 alias、help、version 与 stderr 契约**

```ts
it('supports rotate jwks as the primary command', async () => {
  const dbPath = await createTempDbPath();
  await runCli(['create', dbPath]);
  const result = await runCli(['rotate', 'jwks', dbPath]);
  expect(result.exitCode).toBe(0);
});

it('keeps rotate-jwks as a compatibility alias', async () => {
  const dbPath = await createTempDbPath();
  await runCli(['create', dbPath]);
  const result = await runCli(['rotate-jwks', dbPath]);
  expect(result.exitCode).toBe(0);
});

it('prints unknown command errors to stderr', async () => {
  const result = await runCli(['wat']);
  expect(result.stdout).toBe('');
  expect(result.stderr).toContain('command');
  expect(result.exitCode).toBeGreaterThan(0);
});

it('fails with usage when required args are missing', async () => {
  const result = await runCli(['create']);
  expect(result.stdout).toBe('');
  expect(result.stderr).toContain('USAGE');
  expect(result.stderr).toContain('arg');
  expect(result.exitCode).toBeGreaterThan(0);
});

it('prints version from package metadata', async () => {
  const { default: pkg } = await import('../../package.json');
  const result = await runCli(['--version']);
  expect(result.stdout.trim()).toBe(pkg.version);
});
```

- [ ] **Step 2: 运行测试并确认按预期失败**

Run: `npx vitest run tests/integration/cli-create.test.ts tests/integration/oclif-cli.test.ts`
Expected: FAIL，至少 `rotate jwks`、version 或错误输出与目标行为不符

- [ ] **Step 3: 在 helper 中显式区分 CLI 执行路径，为后续迁移保留测试对象切换点**

```ts
export async function runSourceCli(args: string[]) {
  /* 仅迁移前过渡使用 */
}
export async function runBuiltCli(args: string[]) {
  /* 执行 dist/index.js */
}
export async function runCli(args: string[]) {
  return runSourceCli(args);
}
```

此时 `runCli()` 仍可指向旧入口，但必须把“测旧入口”和“测构建产物入口”的 helper 显式分开，避免后续锁错对象。

- [ ] **Step 4: 再写失败测试，锁定 `start --help` 与 stdout/stderr 分流**

```ts
it('prints help to stdout only', async () => {
  const result = await runCli(['start', '--help']);
  expect(result.exitCode).toBe(0);
  expect(result.stderr).toBe('');
  expect(result.stdout).toContain('USAGE');
});
```

- [ ] **Step 5: 再次运行测试，确认失败原因仍是缺失的新 CLI 契约**

Run: `npx vitest run tests/integration/cli-create.test.ts tests/integration/oclif-cli.test.ts`
Expected: FAIL

- [ ] **Step 6: Commit**

```bash
git add tests/integration/cli-create.test.ts tests/integration/oclif-cli.test.ts
git commit -m "test: lock oclif cli behavior contract"
```

### Task 2: 为执行层公开契约写失败测试

**Files:**

- Modify: `tests/unit/start-command.test.ts`
- Modify: `tests/integration/http-logging.test.ts`
- Modify: `tests/integration/sessions.test.ts`
- Modify: `tests/integration/jwks.test.ts`
- Modify: `tests/unit/cli.test.ts`
- Modify: `tests/helpers/cli.ts`
- Modify: `src/commands/start.ts`

- [ ] **Step 1: 将执行层测试改为面向新公开契约，而不是文件迁移本身**

```ts
const module = await import('../../src/app/commands/start.js');
expect(module.runStartCommand).toBeTypeOf('function');

const server = await module.runStartCommand({ dbPath: '/tmp/auth-mini.db' });
expect(server.close).toBeTypeOf('function');
```

同时给其他关键公开契约写明确断言，而不是只写“同样改动”：

```ts
expect(normalizeOriginOption('https://one.example')).toEqual([
  'https://one.example',
]);
expect(
  normalizeOriginOption(['https://one.example', 'https://two.example']),
).toEqual(['https://one.example', 'https://two.example']);
expect(normalizeOriginOption(undefined)).toBeUndefined();
```

```ts
await runRotateJwksCommand({ dbPath });
expect(await countRows(dbPath, 'jwks_keys')).toBe(2);
```

并保留对 logger sink 注入仍发生在 app command 边界的断言。

另外补一组命令层解析测试，直接锁定 `oclif` 对 `--origin` 的处理，而不是只锁定 helper：

```ts
it('passes repeated --origin values to runStartCommand in order', async () => {
  const runStartCommand = vi.fn();
  // mock ../../src/app/commands/start.js
  // 执行 start command：['db.sqlite', '--origin', 'https://one.example', '--origin', 'https://two.example']
  expect(runStartCommand).toHaveBeenCalledWith(
    expect.objectContaining({
      origin: ['https://one.example', 'https://two.example'],
    }),
  );
});

it('passes a single --origin as a one-item array', async () => {
  const runStartCommand = vi.fn();
  // 执行 start command：['db.sqlite', '--origin', 'https://one.example']
  expect(runStartCommand).toHaveBeenCalledWith(
    expect.objectContaining({
      origin: ['https://one.example'],
    }),
  );
});
```

- [ ] **Step 2: 运行定向测试并确认因新契约模块尚未存在而失败**

Run: `npx vitest run tests/unit/start-command.test.ts tests/integration/http-logging.test.ts tests/integration/sessions.test.ts tests/integration/jwks.test.ts tests/unit/cli.test.ts`
Expected: FAIL，报 `src/app/commands/*` 模块不存在

- [ ] **Step 3: 将实现迁移到 `src/app/commands/*`，保持公开契约不变**

```ts
// src/app/commands/options.ts
export function normalizeOriginOption(
  origin: string | string[] | undefined,
): string[] | undefined {
  if (origin === undefined) return undefined;
  return Array.isArray(origin) ? origin : [origin];
}
```

`runCreateCommand()`、`runStartCommand()`、`runRotateJwksCommand()` 也迁移到新路径，并保持原签名；尤其 `runStartCommand()` 继续返回 `Promise<{close(): Promise<void>}>`。

- [ ] **Step 4: 更新所有消费者，移除旧 `src/cli/*`**

至少覆盖：

```text
tests/unit/start-command.test.ts
tests/integration/http-logging.test.ts
tests/integration/sessions.test.ts
tests/integration/jwks.test.ts
tests/helpers/cli.ts
tests/unit/cli.test.ts
src/index.ts
```

- [ ] **Step 5: 重跑测试确认执行层契约仍然成立**

Run: `npx vitest run tests/unit/start-command.test.ts tests/integration/http-logging.test.ts tests/integration/sessions.test.ts tests/integration/jwks.test.ts tests/unit/cli.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/app/commands src/index.ts tests/unit/start-command.test.ts tests/integration/http-logging.test.ts tests/integration/sessions.test.ts tests/integration/jwks.test.ts tests/helpers/cli.ts tests/unit/cli.test.ts
git rm src/cli/create.ts src/cli/start.ts src/cli/rotate-jwks.ts src/cli/options.ts
git commit -m "refactor: move cli execution into app commands"
```

## Chunk 2: 同批完成 oclif 启动与真实打包路径

### Task 3: 引入明确的 oclif 启动方案并跑真实 `npm pack` 烟测

**Files:**

- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `tsconfig.build.json`
- Modify: `src/index.ts`
- Create: `src/commands/base.ts`
- Create: `src/commands/create.ts`
- Create: `src/commands/start.ts`
- Create: `src/commands/rotate/jwks.ts`
- Modify: `tests/helpers/cli.ts`
- Modify: `tests/integration/oclif-cli.test.ts`
- Modify: `tests/integration/cli-create.test.ts`

- [ ] **Step 1: 写失败测试，要求打包后在临时安装目录中可执行 `auth-mini --help` 与 `auth-mini start --help`**

这些测试必须从 `runPackedCli()` 走完整链路：`rm -rf dist && npm run build && npm pack`，然后在临时目录安装 tarball，再执行二进制；不能复用陈旧 `dist/`。

```ts
it('runs help from a packed install artifact', async () => {
  const result = await runPackedCli(['--help']);
  expect(result.exitCode).toBe(0);
  expect(result.stdout).toContain('auth-mini');
});

it('runs start help from a packed install artifact', async () => {
  const result = await runPackedCli(['start', '--help']);
  expect(result.exitCode).toBe(0);
  expect(result.stdout).toContain('USAGE');
});

it('discovers nested rotate jwks command from the packed artifact', async () => {
  const result = await runPackedCli(['rotate', 'jwks', '--help']);
  expect(result.exitCode).toBe(0);
  expect(result.stdout).toContain('USAGE');
});

it('routes rotate-jwks alias from the packed artifact', async () => {
  const result = await runPackedCli(['rotate-jwks', '--help']);
  expect(result.exitCode).toBe(0);
});

it('prints version from the packed artifact metadata', async () => {
  const { default: pkg } = await import('../../package.json');
  const result = await runPackedCli(['--version']);
  expect(result.stdout.trim()).toBe(pkg.version);
});
```

- [ ] **Step 2: 运行测试，确认当前还没有 `npm pack` + 临时安装执行链路而失败**

Run: `npx vitest run tests/integration/oclif-cli.test.ts tests/integration/cli-create.test.ts`
Expected: FAIL

- [ ] **Step 3: 在 helper 中实现真实打包执行流程**

要求 helper 至少提供三类执行器，并在 Task 3 完成后把正式契约测试切到构建/打包入口：

```ts
runSourceCli(args);
runBuiltCli(args);
runPackedCli(args);
```

```ts
// 1. rm -rf dist
// 2. npm run build
// 3. npm pack
// 4. 在临时目录 npm install <tarball>
// 5. 执行 node_modules/.bin/auth-mini
```

- [ ] **Step 4: 增加 `oclif` 依赖和明确的包元数据**

```json
{
  "bin": {
    "auth-mini": "dist/index.js"
  },
  "dependencies": {
    "@oclif/core": "<version>",
    "oclif": "<version>"
  },
  "oclif": {
    "bin": "auth-mini",
    "commands": "./dist/commands"
  }
}
```

- [ ] **Step 5: 安装依赖并确认 lockfile 更新**

Run: `npm install`
Expected: PASS

- [ ] **Step 6: 用明确的 ESM 启动入口替换旧 `cac` bootstrap**

最终接线必须满足：

```ts
#!/usr/bin/env node
import { run } from '@oclif/core';

await run();
```

并确保构建后存在：

```text
dist/index.js
dist/commands/create.js
dist/commands/start.js
dist/commands/rotate/jwks.js
```

命令发现必须依赖打包后的 `dist/commands/*`，而不是运行时回退到源码目录。

- [ ] **Step 7: 用命令类接上 `create`、`start`、`rotate jwks` 与 alias**

```ts
export default class RotateJwksCommand extends BaseCommand {
  static aliases = ['rotate-jwks'];
  static args = { dbPath: Args.string({ required: true }) };

  async run(): Promise<void> {
    const { args } = await this.parse(RotateJwksCommand);
    await runRotateJwksCommand({ dbPath: args.dbPath });
  }
}
```

- [ ] **Step 8: 统一 version 来源到 `package.json` 元数据，不保留源码硬编码版本**

- [ ] **Step 9: 跑行为测试与真实打包烟测，确认 `oclif` 启动、alias、help、version、打包路径全部转绿**

Run: `npx vitest run tests/integration/cli-create.test.ts tests/integration/oclif-cli.test.ts`
Expected: PASS

- [ ] **Step 9.1: 将 Task 1 锁定的那组 CLI 契约测试切换到 `runBuiltCli()` 或 `runPackedCli()` 并重跑**

确保迁移后同一组契约断言测到的是新的 `oclif` bootstrap，而不是旧 helper。

- [ ] **Step 10: Commit**

```bash
git add package.json package-lock.json tsconfig.build.json src/index.ts src/commands tests/helpers/cli.ts tests/integration/oclif-cli.test.ts tests/integration/cli-create.test.ts
git commit -m "feat: adopt oclif for packaged cli entrypoint"
```

### Task 4: 为 `start` 生命周期写失败测试并实现 signal/shutdown 行为

**Files:**

- Modify: `src/commands/start.ts`
- Modify: `tests/unit/start-command.test.ts`
- Modify: `tests/integration/oclif-cli.test.ts`

- [ ] **Step 1: 先抽出一个可测试的纯生命周期编排器接口，再为它写失败测试**

例如在 `src/commands/start.ts` 导出最小纯函数：

```ts
export function createStartLifecycle(input: {
  close(): Promise<void>;
  on(signal: NodeJS.Signals, handler: () => void): void;
  off(signal: NodeJS.Signals, handler: () => void): void;
  onCloseError?(error: unknown): Promise<void> | void;
});
```

该函数只负责编排 signal 注册、幂等关闭和监听器清理；命令类本身调用它，不新增测试专用分支。

- [ ] **Step 2: 写失败测试，锁定 signal 注册、单次关闭、监听器清理和 close error 路径**

```ts
it('registers SIGINT and SIGTERM handlers', () => {
  const on = vi.fn();
  const off = vi.fn();
  createStartLifecycle({ close: vi.fn(), on, off });
  expect(on).toHaveBeenCalledWith('SIGINT', expect.any(Function));
  expect(on).toHaveBeenCalledWith('SIGTERM', expect.any(Function));
});

it('closes the server only once when shutdown signals repeat', async () => {
  const close = vi.fn().mockResolvedValue(undefined);
  const on = vi.fn();
  const off = vi.fn();
  const lifecycle = createStartLifecycle({ close, on, off });
  const shutdown = on.mock.calls[0][1];
  await shutdown();
  await shutdown();
  expect(close).toHaveBeenCalledTimes(1);
});

it('removes listeners after shutdown and forwards close errors', async () => {
  const error = new Error('close failed');
  const close = vi.fn().mockRejectedValue(error);
  const on = vi.fn();
  const off = vi.fn();
  const onCloseError = vi.fn();
  createStartLifecycle({ close, on, off, onCloseError });
  const shutdown = on.mock.calls[0][1];
  await shutdown();
  expect(off).toHaveBeenCalled();
  expect(onCloseError).toHaveBeenCalledWith(error);
});
```

- [ ] **Step 3: 再写一个命令级失败测试，锁定 `start` 在收到信号前保持存活、收到信号后退出**

```ts
it('keeps start alive until shutdown signal arrives', async () => {
  // 启动 start 命令
  // 断言进程/命令在信号前未退出
  // 发送 SIGTERM 后断言退出
});
```

- [ ] **Step 4: 运行测试确认失败**

Run: `npx vitest run tests/integration/oclif-cli.test.ts`
Expected: FAIL

- [ ] **Step 5: 在 `start` 命令适配层实现信号与关闭编排**

实现必须满足：

- 注册 `SIGINT` / `SIGTERM`
- 重复信号只关闭一次
- 关闭完成后移除监听器
- 关闭异常通过命令错误路径返回给用户

- [ ] **Step 6: 重跑测试确认生命周期行为转绿**

Run: `npx vitest run tests/integration/oclif-cli.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/commands/start.ts tests/integration/oclif-cli.test.ts
git commit -m "feat: add start command lifecycle handling"
```

### Task 5: 为默认错误与 `--verbose` 写失败测试并实现分层错误模型

**Files:**

- Modify: `src/commands/base.ts`
- Modify: `src/commands/create.ts`
- Modify: `tests/integration/oclif-cli.test.ts`

- [ ] **Step 1: 写失败测试，覆盖默认错误与 `--verbose` 输出差异**

```ts
it('prints concise command errors by default', async () => {
  const result = await runCli([
    'create',
    '/tmp/db.sqlite',
    '--smtp-config',
    './missing.json',
  ]);
  expect(result.stderr).toContain('Error:');
  expect(result.stderr).toContain('Hint:');
  expect(result.stderr).not.toContain('Stack:');
});

it('prints detailed diagnostics with --verbose', async () => {
  const result = await runCli([
    'create',
    '/tmp/db.sqlite',
    '--smtp-config',
    './missing.json',
    '--verbose',
  ]);
  expect(result.stderr).toContain('Stack:');
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/integration/oclif-cli.test.ts`
Expected: FAIL

- [ ] **Step 3: 在 `BaseCommand` 中实现统一错误格式化与 stderr 输出**

```ts
protected async catch(error: Error & {exitCode?: number}): Promise<any> {
  // 默认输出 Error/Hint/See
  // verbose 时追加 cause 与 stack
}
```

- [ ] **Step 4: 如需要，在具体命令中补足面向用户的 hint 映射**

- [ ] **Step 5: 重跑测试确认错误层行为转绿**

Run: `npx vitest run tests/integration/oclif-cli.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/commands/base.ts src/commands/create.ts tests/integration/oclif-cli.test.ts
git commit -m "feat: add layered cli error reporting"
```

## Chunk 3: 文档与全量验证

### Task 6: 更新 README 与命令示例

**Files:**

- Modify: `README.md`
- Modify: `tests/integration/oclif-cli.test.ts`

- [ ] **Step 1: 写失败测试，锁定 README 中的新命令结构与兼容说明**

```ts
const readme = await readFile('README.md', 'utf8');
expect(readme).toContain('auth-mini rotate jwks ./auth-mini.sqlite');
expect(readme).toContain('rotate-jwks');
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/integration/oclif-cli.test.ts`
Expected: FAIL

- [ ] **Step 3: 更新 README 中的 CLI 示例、错误体验与 alias 说明**

```md
npx auth-mini rotate jwks ./auth-mini.sqlite

Compatibility note: `rotate-jwks` remains available during the transition release.
```

- [ ] **Step 4: 重跑测试确认文档断言转绿**

Run: `npx vitest run tests/integration/oclif-cli.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add README.md tests/integration/oclif-cli.test.ts
git commit -m "docs: update cli usage for oclif migration"
```

### Task 7: 全量验证与收尾

**Files:**

- Verify: `docs/superpowers/specs/2026-04-05-oclif-cli-migration-design.md`
- Verify: `docs/superpowers/plans/2026-04-05-oclif-cli-migration.md`

- [ ] **Step 1: 跑定向 CLI 与执行层测试**

Run: `npx vitest run tests/unit/cli.test.ts tests/unit/start-command.test.ts tests/integration/cli-create.test.ts tests/integration/cli-logging.test.ts tests/integration/oclif-cli.test.ts tests/integration/http-logging.test.ts tests/integration/sessions.test.ts tests/integration/jwks.test.ts`
Expected: PASS

- [ ] **Step 2: 跑全量测试**

Run: `npm test`
Expected: PASS

- [ ] **Step 3: 跑类型检查、lint、build**

Run: `npm run typecheck && npm run lint && npm run build`
Expected: PASS

- [ ] **Step 4: 验证构建产物中的版本与帮助输出**

Run: `node dist/index.js --version && node dist/index.js --help`
Expected: PASS，且 `--version` 输出与 `package.json` 一致

- [ ] **Step 5: 验证真实打包安装产物中的帮助输出**

Run: `npm pack`
Expected: PASS，然后用 Task 3 的 `runPackedCli()` 或等价流程验证打包安装后 `auth-mini --help` 与 `auth-mini start --help` 可用

- [ ] **Step 6: 检查工作区状态**

Run: `git status --short`
Expected: 仅剩本次迁移相关变更

- [ ] **Step 7: Commit**

```bash
git add .
git commit -m "feat: complete oclif cli migration"
```
