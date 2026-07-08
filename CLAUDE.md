# CLAUDE.md

本仓库 = **Zotero Agent（`zotero-agent`）**：从 `cookjohn/zotero-mcp` fork 二次开发后**独立**的发布仓库，插件目录即仓库根。完整变更史见 `CHANGELOG.md`（从上游 v1.5.0 起）。本文件是给未来会话的开发 / 发布上下文。

---

## 1. 架构

- 本插件 = 一个**内嵌 MCP server 的 Zotero 插件**：插件在 Zotero 进程内起 HTTP server（手写 `nsIServerSocket`），端口 **23120**，只绑 `127.0.0.1`
- 常规用法：插件装在**本地** Zotero，AI 客户端（Claude、Codex…）**本地直连** `http://127.0.0.1:23120/mcp`，用 `Authorization: Bearer <PSK>` 认证
- 读还可走 Zotero 官方只读 API（`127.0.0.1:23119`，仅服务浏览器 Connector 的读请求）
- 关键区别：Zotero **进程内** `Zotero.Libraries.userLibraryID` = **1**，与 web 账号那个数字 library ID 不同；写 `run_javascript` 时用进程内的 `1`，调官方 API 路径 `/api/users/<library-id>/` 时才用 web library ID

## 2. 仓库结构（插件为根）

- `src/` `addon/` — 插件 TS 源码 + 资源（manifest / locale / 偏好 UI）
- `test/` — 纯函数单测（`*.test.cjs`，node 直跑）
- `scripts/` — `deploy-live.mjs`（本地 xpi → 目标 Zotero 部署）、`prepare-release.js`（生成 update.json）、`unit-test.mjs`
- `.github/workflows/` — release CI（在**根**，GitHub 才会触发）
- `refs/` — 17 个调研参考 submodule，**声明保留、内容按需**：用哪个再 `git submodule update --init refs/<path>`
- `CHANGELOG.md` — 变更史（人写、提交）；`update.json` — 更新清单（机器生成、不提交，见 §4）

## 3. 开发循环（build + 部署）

改代码 → `npm run build`（`zotero-plugin build` + `tsc --noEmit`，产物 `.scaffold/build/zotero-agent.xpi`）→ `node scripts/deploy-live.mjs`（xpi base64 经 `run_javascript` 写入 Zotero 端临时路径 + 自升级，~5s 断连后即新版）。

- `deploy-live.mjs` 也能装任意 xpi：`node scripts/deploy-live.mjs 路径/xxx.xpi`（如使用者下载的 xpi）。它依赖 zotero MCP 通道（PSK），是"已装本插件后换版 / 升级"的工具；**首次裸装**仍需手动把 xpi 拖进 Zotero

### 测试

- **本地单测**：`npm run test:unit` —— `test/*.test.cjs` 纯函数单测（node 直跑，无框架，runner `scripts/unit-test.mjs`），覆盖 auth / eval / HTTP 字节读取 / MCP 协议 / 元数据合并 / PDF 识别与解析器 / 标题相似度 / hybrid search 等模块
- **部署后全栈回归**：`src/modules/selfTest.ts`，startup 时挂载为 `Zotero.ZoteroAgentSelfTest`。约 31 场景：协议层（initialize 版本协商、401/403、-32601/-32602、`isError` 语义)+ 工具层（import 幂等、批量导入 dry-run、preprint 升级、DOI repair、伴生插件桥接、写类工具 dry-run 默认、搜索降级级联、CJK mojibake 回归、pdf resolvers 往返等）。版本更新部署后跑：`run_javascript` 里 `return await Zotero.ZoteroAgentSelfTest.run('protocol')`；`.list()` 列可用套件

## 4. 发布流程（版本控制 + 云端 CI + update.json）

**版本控制**靠 `npm version`（一步做三件事：改 `package.json` 的 version、建一个 commit、打 tag `v<version>`）。semver = **主.次.补丁** = 破坏性改动 . 向后兼容新功能 . 向后兼容修复：

| 命令 | 效果（从 1.8.2） | 用途 |
|---|---|---|
| `npm run release` | `npm version patch` → 1.8.**3** | 补丁（bugfix） |
| `npm version minor && git push --follow-tags` | 1.**9**.0 | 次版本（新功能，兼容） |
| `npm version major && git push --follow-tags` | **2**.0.0 | 主版本（破坏性） |

`release` script 写死 patch；发 minor / major 手动跑 `npm version minor|major`。

**发布 = 推 tag。** `npm run release` 内含 `git push --follow-tags` 把 `v<version>` tag 推上去。**GitHub 只在 tag 匹配 `v数字.数字.数字` 时触发** `.github/workflows/release.yml`——普通 push commit 不触发，所以发版必须打 tag（用 `npm version`，别手动改版本号）。

**Actions 在云端 build，不是本地。** `runs-on: ubuntu-latest` = GitHub 托管的 Ubuntu 虚拟机：checkout → `npm ci` → `npm run build` → `npm run prepare-release`（生成 update.json）→ 创建 GitHub Release，把 `zotero-agent-<version>.xpi` + `update.json` 作为附件上传。你本地只做 `npm version` + push，build 全在云端。（对比 §3 的 `deploy-live` 是**本地** build，用于开发调试快速部署；CI 云端 build 用于对外分发，两条线独立。）

**update.json 是什么：**
- **来源**：`scripts/prepare-release.js` 在 CI 里**生成**，不手写、不提交（已 gitignore）
- **内容**：Zotero 的自动更新清单 —— `{ addons: { "<addonID>": { updates: [{ version, update_link, applications.zotero.strict_min/max_version }] } } }`。version 从 package.json 读，update_link 指向本次 Release 的 xpi
- **作用**：Zotero 客户端按插件 manifest 里的 `update_url`（= `github.com/psiQAQ/zotero-agent/releases/latest/download/update.json`，`releases/latest` 是活链接，永远指最新 Release）读它，比对版本决定是否自动下载升级
- **和 Release notes 无关**：notes 是给人看的说明文字（release.yml 里目前是占位），update.json 是给机器读的清单；二者同在一个 Release 但用途独立，update.json 不含说明
- **和 CHANGELOG 无程序关系**：CHANGELOG 人写、提交、给开发者 / 用户看；update.json 机器生成、不提交、给 Zotero 客户端看。唯一交集是 version 要一致。发版前应**手动更新 CHANGELOG**，Release notes 可从中摘（当前 workflow 未自动摘）

**已知问题**：`prepare-release.js` 的 beta 分支把 version 又拼了 `-beta.0`，beta 链路的 update_link 版本号会错位；用 `release:beta` 前需先修（正式版 patch / minor / major 链路正常）。

## 5. Zotero 内部 JS API 速记（`run_javascript` 直接用这套）

```js
const libID = Zotero.Libraries.userLibraryID;               // 进程内 = 1
const cid = k => Zotero.Collections.getIDFromLibraryAndKey(libID, k);   // 8 字符 key → id
const iid = k => Zotero.Items.getIDFromLibraryAndKey(libID, k);

// 集合改名 / 改父 / 删除（eraseTx 硬删除，级联子集合，无回收站，不可撤销）
const c = await Zotero.Collections.getAsync(cid('KEY123AB'));
c.name = 'New Name'; c.parentID = cid('PARENT'); await c.saveTx();
await c.eraseTx();  // 先校验 c.getChildItems(true).length===0 && c.getChildCollections().length===0

// 条目改集合 / tag
const item = await Zotero.Items.getAsync(iid('ITEMKEY1'));
item.setCollections([cid('NEW_COLL')]);       // 全替换
item.addTag('New Tag'); item.removeTag('Old Tag'); await item.saveTx();

// 全局 tag 改名（同名自动合并，保留条目关联）/ 删除
await Zotero.Tags.rename(libID, 'old tag', 'Old Tag');
const tagID = Zotero.Tags.getID('Xxx'); if (tagID) await Zotero.Tags.removeFromLibrary(libID, [tagID]);

// 全库遍历
for (const id of await Zotero.Items.getAllIDs(libID)) {
  const it = await Zotero.Items.getAsync(id);
  if (!it.isRegularItem()) continue;           // 跳过 note / attachment
}
```

## 6. 核心踩坑

- **本地 HTTP API 写操作全返回 501**：`127.0.0.1:23119` 是 Zotero 官方只读 Connector 通道，DELETE / PATCH / POST 一律 501。写只能走进程内 DataObject API（本插件 23120 的工具 / `run_javascript` 就是这套）
- `Zotero.Search` 的 `doesNotExist` operator 对 tag 字段无效——找"无 tag"文献只能全库遍历 + `item.getTags().length===0` 自己过滤
- `Zotero.Tags.getAll` 返回同名 double entry（user tag type=0 + auto tag type=1，UI 里显示为一个），去重要按字节比较剔除假重复
- `eraseTx()` 无回收站，破坏性操作前先备份或 dry-run；**写完立刻 GET 回读校验**（别信 `saveTx` promise resolved 就等于成功）
- 中英 tag 合并走 `Zotero.Tags.rename`（不是先删后加，rename 正确保留关联）；批量用 `batch_update_tags` 工具（dry-run 默认，内部即 rename）
- 中文 tag / body 的 mojibake（-32700）**已修**（读取层字节收集 + 单次解码）
- `/mcp/status` 的 version 字段是历史硬编码，查真实版本用 `AddonManager`

## 7. MCP 工具与安全（当前 v2.1.0，46 工具）

- 端口 **23120**，只绑 `127.0.0.1`；POST /mcp 校验 `Authorization: Bearer <PSK>`，并校验 Origin（DNS 重绑定防御）
- **多层防御**：只绑 loopback → PSK → `eval.enabled` 默认**关** → `write.enabled` 默认**关**
- 写类工具 **dry-run 默认**，`confirm: true` 才执行；长尾操作用 `run_javascript`（需偏好页开 eval；长任务传 `timeout_ms`）
- 工具集覆盖：search / get / collections / tag / note / metadata / item + `import_by_identifier` / `import_bibliography` / `find_missing_pdfs` / `find_related_papers` / `synthesize_annotations` / `find_duplicates` + `merge_duplicates` / `batch_update_tags` / `manage_pdf_resolvers` / `enrich_item_metadata` / `find_doi`（含 repair 模式）/ `upgrade_preprints` / `fetch_chinese_metadata` + `lint_metadata`（伴生插件桥接）等
- 接入本机 Claude Code：`claude mcp add --transport http zotero http://127.0.0.1:23120/mcp --header "Authorization: Bearer <PSK>"`（PSK 从插件偏好页复制）

## 8. 快速恢复对话（新会话跳这里）

- 启动本地 Zotero（已装本插件），AI 客户端本地直连 `http://127.0.0.1:23120/mcp`（Bearer PSK，从插件偏好页复制）
- 验证官方读通路：`curl -sD - http://127.0.0.1:23119/api/users/<library-id>/items?limit=1` → 200
- 改代码 → `npm run build` → `node scripts/deploy-live.mjs` → selfTest 回归（`Zotero.ZoteroAgentSelfTest.run('protocol')`）
- 发版 → `npm run release`（patch）或 `npm version minor|major && git push --follow-tags` → 云端 CI 自动 build + 发 Release + 传 update.json
- 破坏性操作（`eraseTx` 无回收站）前先备份 / dry-run，写后回读校验
- 参考仓库按需拉：`git submodule update --init refs/<path>`
