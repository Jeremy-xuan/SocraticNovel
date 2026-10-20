# SillyTavern 源码级调研（2026-09-22 · 重做版）

> 🔴 **本件的来历**：第一版（`SocraticNovel_酒馆研究_2026-09-22.md`）**只读文档、没读源码**，已降级为"文档级参考"。
> 第二版**派了源码级子代理，但那个子代理失败了**：**零落盘**（违反了"每核一条立刻写盘"的指令，把内容全攒在输出流里），收尾消息**退化成同一段话重复十余遍**（`交接文档.md` §0.8 已记录过这类"退化重复"故障）→ **磁盘上没有任何文件**。
> **本件因此由主代理自己核源码后撰写**。每条都给 **文件 + 行号 + 逐字代码**。
> **源码基准**：`github.com/SillyTavern/SillyTavern`，分支 `release`，抓取日 **2026-09-22**。仓库 33,660★，**AGPL-3.0**。

---

## §0 已核实的源码事实（主代理亲自核，可复跑）

### 0.1 🔴 depth 的语义：**0 = 上下文里的最后一条消息**（官方源码注释逐字）
`public/script.js:8921`
```
 * @param {number} depth Insertion depth. 0 represets the last message in context. Expected values up to MAX_INJECTION_DEPTH.
```
> 注：`represets` 是源码里的**原拼写错误**，逐字照录。
→ **这是 depth 语义的一手依据**（比文档更硬）。

### 0.2 🔴 注入深度是**硬编码 10000 层**，不是"有多少层就循环多少层"
`public/script.js:500`
```
export const MAX_INJECTION_DEPTH = 10000;
```
`public/script.js:3281-3291`
```js
export function getExtensionPromptMaxDepth() {
    return MAX_INJECTION_DEPTH;
    /*
    const prompts = Object.values(extension_prompts);
    const maxDepth = Math.max(...prompts.map(x => x.depth ?? 0));
    // Clamp to 1 <= depth <= MAX_INJECTION_DEPTH
    return Math.max(Math.min(maxDepth, MAX_INJECTION_DEPTH), 1);
    */
}
```
→ **"按实际注册的深度算最大值"那段被注释掉了**，当前版本**无条件返回 10000**。
→ 而 `openai.js:821` 的循环是 `for (let i = 0; i <= maxDepth; i++)` → **每次生成要循环 10001 次**（每次 `filter` 全部 absolute prompts）。语义上没错（深的地方很快为空），但**是真实的源码事实**。

### 0.3 注入的完整实现（`public/scripts/openai.js`）
- **函数** `populationInjectionPrompts(prompts, messages)` **@ 810**
- **循环** `for (let i = 0; i <= maxDepth; i++)` **@ 821**
- 取 `prompt.injection_depth === i && prompt.content` **@ 822**
- **按 `injection_order` 分组，从高到低排**：`const orders = Object.keys(orderGroups).sort((a, b) => +b - +a);` **@ 842**
- **同 order 内按 role 顺序** `const roles = ['system', 'user', 'assistant'];` **@ 847**，源码注释逐字：*"Order of priority for roles (most important go lower)"*
- **插入**：`const injectIdx = i + totalInsertedMessages; messages.splice(injectIdx, 0, ...roleMessages);` **@ 866-867**
- 🔴 **紧接着 `messages = messages.reverse();` @ 873**
→ 说明传进来的 `messages` 是**最新在前**，所以 **depth 0 插在最新消息之前 → 反转后落在 prompt 最末尾** ✅ 与 0.1 的注释一致。

### 0.4 🔴 固定顺序（`openai.js:1212-1218`，逐字）
```js
    // Character and world information
    await addToChatCompletion('worldInfoBefore');
    await addToChatCompletion('main');
    await addToChatCompletion('worldInfoAfter');
    await addToChatCompletion('charDescription');
    await addToChatCompletion('charPersonality');
    await addToChatCompletion('scenario');
    await addToChatCompletion('personaDescription');
```
紧接一行注释：*"Collection of control prompts that will always be positioned last"*。
→ **这就是"谁在前谁在后"的源码事实**：世界书前置 → 主提示 → 世界书后置 → **角色描述 → 角色性格 → 场景** → 用户 persona。

### 0.5 相对注入靠"锚点标识符"定位（`openai.js:1187-1205`）
```js
    const addToChatCompletion = async (source, target = null) => {
        if (false === prompts.has(source)) return;
        if (promptManager.isPromptDisabledForActiveCharacter(source) && source !== 'main') { …return; }
        const prompt = prompts.get(source);
        if (prompt.injection_position === INJECTION_POSITION.ABSOLUTE) {
            promptManager.log(`Skipping prompt ${source} because it is an absolute prompt`);
            return;
        }
        const index = target ? prompts.index(target) : prompts.index(source);
        const collection = new MessageCollection(source);
        const message = await Message.fromPromptAsync(prompt);
        collection.add(message);
        chatCompletion.add(collection, index);
    };
```
🔴 **关键细节**：`ABSOLUTE` 位置的注入**在这里被跳过**（只有"相对"注入走这条路）。

### 0.6 `injection_order` 默认 100（`public/scripts/PromptManager.js`）
`@ 32`：`const DEFAULT_ORDER = 100;` ｜ `@ 193`：`this.injection_order = injection_order ?? DEFAULT_ORDER;`

### 0.7 顺序从哪来：**每个角色一份 prompt 顺序表**
`PromptManager.js:1516` `getPromptCollection(generationType)`：
```js
        const promptOrder = this.getPromptOrderForCharacter(this.activeCharacter);
        promptOrder.forEach(entry => {
            const prompt = this.getPromptById(entry.identifier);
            const allowedTrigger = entry.enabled && this.shouldTrigger(prompt, generationType);
            if (!prompt) { return; }
            if (allowedTrigger) {
                promptCollection.add(this.preparePrompt(prompt));
            } else if (entry.identifier === 'main') {
                // Some extensions require main prompt to be present for relative inserts.
                // So we make a GMO-free vegan replacement.
                const replacementPrompt = structuredClone(prompt);
                replacementPrompt.content = '';
                promptCollection.add(this.preparePrompt(replacementPrompt));
            }
        });
```
- `index(identifier)` **@ 274**：`return this.collection.findIndex(prompt => prompt.identifier === identifier);` → **顺序 = 数组顺序**
- 🔴 **即使 `main` 被关掉，也会以"空内容占位"加进集合**（注释逐字：*"So we make a GMO-free vegan replacement"*）→ 所以 `prompts.index('main')` 永远可用，相对注入才有锚点。
- 顺序来源 = `getPromptOrderForCharacter(activeCharacter)`（Prompt Manager 的拖拽排序 ＋ **角色卡可覆盖**）。

### 0.8 发送时不再反转
`openai.js:3972`：`getMessages() { return this.messages; }` → **没有第二次 reverse**。
→ **最终发送顺序 = 0.3 里 `messages.reverse()` 之后的数组顺序**。

### 0.9 🔴 注入 API 的真实位置与形态（**更正**：不在 `extensions.js`）

> ⚠️ **更正记录**：派发任务书时我写了"`setExtensionPrompt()` / `getExtensionPrompt()`（在 `extensions.js`）"—— **这是错的**。实测 `extensions.js`（88,263 B）里**这两个函数 0 命中**。真实位置如下（**全部在 `public/script.js`**）：

| 函数 | 位置 | 作用 |
|---|---|---|
| `extension_prompt_types` | **`script.js:484`** | 枚举：**`IN_PROMPT: 0`／`IN_CHAT: 1`** |
| `setExtensionPrompt(key, value, position, depth, scan=false, role=SYSTEM, filter=null)` | **`script.js:8926`** | **注册**一条注入 |
| `getExtensionPrompt(position=IN_PROMPT, depth, separator='\n', role, wrap=true)` | **`script.js:3301`** | **取出**（按位置+深度+角色） |
| `getExtensionPromptMaxDepth()` | **`script.js:3281`** | 返回 `MAX_INJECTION_DEPTH`（10000） |

**`setExtensionPrompt` 的完整实现（13 行，逐字）**：
```js
export function setExtensionPrompt(key, value, position, depth, scan = false, role = extension_prompt_roles.SYSTEM, filter = null) {
    extension_prompts[key] = {
        value: String(value),
        position: Number(position),
        depth: Number(depth),
        scan: !!scan,
        role: Number(role ?? extension_prompt_roles.SYSTEM),
        filter: filter,
    };
}
```
🔴 **这就是"每轮注入"的最小接口**：**7 个参数**表达完"往哪插（position）／插多深（depth）／以谁的口吻（role）／要不要触发世界书扫描（scan）／过滤（filter）"。
→ **对我们的直接价值**：我们的纪律层若要"按位置注入"，需要的就是**同样这 7 个维度的定义**，而不是一个含糊的"重要规则"列表。

### 0.10 顺带定位：角色的 `depth_prompt` 读自哪
`script.js:4484`：
```js
const depthPromptRole = getExtensionPromptRoleByName(characters[this_chid]?.data?.extensions?.depth_prompt?.role ?? depth_prompt_role_default);
```
→ V2 卡里 `depth_prompt` 的**实现位置是 `data.extensions.depth_prompt`**（字段在 `extensions` 命名空间下，不在 `data` 顶层）。另有 `beforeScenarioAnchor` @ `script.js:4700` 使用 `getExtensionPrompt(extension_prompt_types.BEFORE_PROMPT)`。

---

## §1 文档 vs 源码：文档把我们带偏在哪

| # | 文档说法 | 源码事实 | 后果 |
|---|---|---|---|
| 1 | "Post-History Instructions" 是 prompt 列表**最底部的一项**（听起来是一个独立机制） | 全文 `post_history` **0 命中**；它实际是 **`injection_depth` 的一个取值**，与 Author's Note、World Info 的 `@D` **共用同一套实现** | 🔴 我们一度把它当成**两个可分别照搬的机制**（"贴尾部" + "固定深度"）→ 实际是**同一件事** |
| 2 | "The higher the number, the deeper it is sent" | 一致；且源码注释给了更硬的定义：**0 = 最后一条消息** | 我们的"贴尾部"结论**成立**，但依据应升级为源码注释 |
| 3 | 文档只描述界面选项（depth、order、position） | 源码显示**顺序来自每角色一份 order 表**，且 `main` 会被空占位 | "顺序"不是全局设置，而是**可按角色覆盖**的 |
| 4 | —— | **`MAX_INJECTION_DEPTH = 10000` 硬编码**、聪明的版本被注释掉 | 文档完全没提；这是纯源码事实 |

---

## §2 🔴 对我们架构的结论（这节才是产出）

1. **② 纪律层与 ⑤ 锚定层是同一实现的不同取值** —— 都用"固定深度注入"。**我们只设计一套**。
2. **位置语义已有一手定义**：`depth 0 = 上下文最后一条消息`（源码注释）。我们要的"贴尾部"就是这个。
3. **"顺序"是可以按角色覆盖的** —— 酒馆把每个角色的 prompt 顺序存成一份表。对我们：**教室文件里可以带一份"这节课的加载顺序表"**，而不是全教室共用一套硬顺序。
4. **锚点思想可借**：酒馆的相对注入靠"锚点标识符"（`worldInfoBefore` / `main` / `charDescription`…）定位，且**锚点即使被关掉也保留空占位**。
   → 对我们：**纪律层需要一个稳定的"锚点位置"**，不能因为某节课不加载某个文件就失去落点。
5. **`ABSOLUTE` 与"相对"是两类注入**：绝对位置注入**不参与**相对定位。我们只需要"相对"这一类。

### 仍未核（诚实列出）
- `ChatCompletion.insert` / `getAllMessages` 的内部实现（§0.8 已从 `getMessages()` 推断"不再反转"，但未读 `insert` 本体）
- 宏求值的确切时机（`macros.js` 未读）
- 摘要扩展的注入位置与幻觉处理（未读）
- World Info 扫描实现（未读；"注入不可预测"仍是**文档级**结论）
- `getPromptOrderForCharacter` 的默认表内容（只确认了它的存在与调用点）

---

## §3 来源与可复跑

```bash
# 抓取（release 分支）
curl -sSL -o st_openai.js  https://raw.githubusercontent.com/SillyTavern/SillyTavern/release/public/scripts/openai.js
curl -sSL -o st_pm.js      https://raw.githubusercontent.com/SillyTavern/SillyTavern/release/public/scripts/PromptManager.js
curl -sSL -o st_script.js  https://raw.githubusercontent.com/SillyTavern/SillyTavern/release/public/script.js
# 复核
grep -n "MAX_INJECTION_DEPTH" st_script.js            # → 500 / 3282
grep -n "getExtensionPromptMaxDepth" st_script.js     # → 3281
sed -n '810,875p' st_openai.js                        # 注入实现
sed -n '1212,1218p' st_openai.js                      # 固定顺序
grep -n "DEFAULT_ORDER" st_pm.js                      # → 32 / 193
```
**实测体量**：`st_openai.js` 307,267 B ｜ `st_script.js` 497,669 B / 12,599 行 ｜ `st_pm.js` 90,717 B / 2,144 行
**存证**：`开源线/证据/酒馆源码/`（含 SHA-256）

---
