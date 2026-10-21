// lib/toolshape.mjs — 本地 `defineTool`：把**作者面**工具声明编译成宿主 `ctx.tools.register()` 要的形状。
//
// 🔴 为什么要有一份本地的（B2，2026-10-21）：
//   0.1.5 的宿主会把 `@deepseek-ai/*` 放进「安装版回退目录」，插件 `import` 它不落进 profile；
//   0.2.1 删掉了那个回退 —— 插件一旦 `import '@deepseek-ai/dsh-tools'`，包就**必须**写进
//   自己的 `dependencies`，于是 profile 的 node_modules 里必然出现 `@deepseek-ai/*`，
//   验收流水线的铁律③（不许双实例 / Symbol 失配）必然红。所以这一层只能自己实现。
//
// 复刻范围（逐条对照 0.2.1-rc.2 的 `@deepseek-ai/dsh-tools/lib/index.js`）：
//   ① `defineTool(options)`：把作者面 schema 编译成受支持的 raw JSON Schema 子集，
//      并给 `execute` 套一层参数校验（非法参数 → `ToolArgsError`，消息 `invalid arguments: …`）。
//   ② 作者面 schema 的编译规则（`compileValueSchema` / `compilePropertyMap`）：
//      · 每层允许的键：type / properties / additionalProperties / items / enum / const / oneOf
//        ＋ 注解 description / title / default / examples；
//      · `required: true` 只写在**属性**上（`{ type:'string', required:true }`），编译时收集到
//        父对象的 `required: [...]`；根上不许写 `required`；
//      · `type:'object'` 必须显式写 `additionalProperties: true|false`（宿主不替你猜）；
//      · `type:'json'` ＝ 无约束 JSON（编译成一个只有注解、没有 type 的节点）；
//      · `oneOf` 至少两支，且不能与 `type` 同时出现。
//   ③ 参数校验（`validateJsonSchemaValue`）覆盖本仓库用到的全部关键字：
//      type / properties / required / additionalProperties / items / enum / const / oneOf，
//      消息文案与路径写法（`arguments.lesson`、`arguments.items[0]`）逐字对齐宿主。
//
// **没有**复刻的（宿主有、这里没有；写清楚，免得以后有人以为等价）：
//   · `HarnessError` 类身份：本模块的 `ToolArgsError` 只带 `name`/`code`，不是宿主的
//     `instanceof HarnessError`。后果只有一个：工具失败结果里的 `error: { name, code }`
//     结构化元数据会缺（宿主的 `errorInfo()` 认不出我们），正文消息不受影响。
//     `presentCall/presentResult/isConcurrencySafe` 的**软校验**（非法参数时退回 undefined/false）
//     这里照样做了 —— 这几个字段本仓库目前没人用，但不做等于给以后埋一个静默降级点。
//   · `assertSupportedJsonSchema`：编译产物是否属于子集，由宿主 `ctx.tools.register()` 那一层
//     继续把关（它一定会跑）。这里不重复实现，免得两处判据漂移。
//
// 宿主升级后怎么发现漂移：见 `tools/probes/toolshape-drift/`（拿本模块的产物与真宿主的
// `defineTool` 逐字段比对），以及本目录 README「宿主契约的两个盯点」。

/** 宿主 `SCHEMA_TYPES`：raw schema 的 type 只许单值。 */
const SCHEMA_TYPES = ['object', 'array', 'string', 'number', 'integer', 'boolean', 'null']

/** 宿主 `ANNOTATION_KEYS`：可以出现在任何层、原样透传的注解键。 */
const ANNOTATION_KEYS = ['description', 'title', 'default', 'examples']

/** 作者面节点允许的键（`required` 只在属性位由 compileProperty 单独处理）。 */
const VALUE_KEYS = new Set([...ANNOTATION_KEYS, 'type', 'properties', 'additionalProperties', 'items', 'enum', 'const', 'oneOf'])

/** 抛给模型看的参数错误：与宿主的 `ToolArgsError` 同形（名字、code、消息前缀）。 */
export class ToolArgsError extends Error {
  /**
   * @param {string[]} violations - 逐条违规描述
   */
  constructor(violations) {
    super(`invalid arguments: ${violations.join('; ')}`)
    this.name = 'ToolArgsError'
    this.code = 'INVALID_ARGS'
    this.violations = violations
  }
}

/** 编译期的作者错误（写错 schema 是**我们**的错，不是模型的错）。 */
function authorError(message) {
  return new Error(`defineTool schema: ${message}`)
}

/**
 * 断言作者面节点只用了允许的键。
 * @param {object} input - 作者面节点
 * @param {string} path - 诊断路径
 * @param {Set<string>} allowed - 该层允许的键（含 required 视位置而定）
 */
function assertAuthorKeys(input, path, allowed) {
  for (const key of Object.keys(input)) {
    if (!allowed.has(key)) throw authorError(`${path}.${key} is not a supported key (allowed: ${[...allowed].join('/')})`)
  }
}

/** 复制注解（与宿主 `copyAnnotations` 同序：description/title/default/examples）。 */
function copyAnnotations(source, target) {
  for (const key of ANNOTATION_KEYS) {
    if (Object.hasOwn(source, key)) target[key] = source[key]
  }
}

/** 是否是可当 schema/对象用的普通记录。 */
function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * 编译一个**属性表**（工具的 `parameters`）：返回 `{ properties, required? }`。
 * @param {object} input - `{ 参数名: 作者面节点 }`
 * @param {string} path - 诊断路径
 * @returns {{properties: object, required?: string[]}}
 */
function compilePropertyMap(input, path, seen = new Set()) {
  if (!isRecord(input)) throw authorError(`${path} must be an object of value schemas`)
  if (seen.has(input)) throw authorError(`${path} is circular`)
  seen.add(input)
  const properties = {}
  const required = []
  for (const [key, property] of Object.entries(input)) {
    const propertyPath = `${path}.${key}`
    if (!isRecord(property)) throw authorError(`${propertyPath} must be a value schema object`)
    if (Object.hasOwn(property, 'required') && property.required !== true) {
      throw authorError(`${propertyPath}.required must be true when present`)
    }
    if (property.required === true) required.push(key)
    const allowed = new Set(VALUE_KEYS)
    allowed.add('required') // 属性位允许写 `required: true`
    properties[key] = compileValue(property, propertyPath, allowed, seen)
  }
  return required.length > 0 ? { properties, required } : { properties }
}

/**
 * 编译一个**值节点**。
 * @param {object} input - 作者面节点
 * @param {string} path - 诊断路径
 * @param {Set<string>} allowed - 该层允许的键
 * @param {Set<object>} seen - 当前路径上的祖先节点（循环 schema 在宿主那里同样被拒）
 * @returns {object} 受支持的 raw JSON Schema 节点
 */
function compileValue(input, path, allowed, seen = new Set()) {
  if (!isRecord(input)) throw authorError(`${path} must be a value schema object`)
  if (seen.has(input)) throw authorError(`${path} is circular`)
  seen.add(input)
  assertAuthorKeys(input, path, allowed)
  const node = {}
  // 🔴 键序跟着宿主走（`type`/`oneOf` 先写，注解其次，其余最后）：编译产物逐字节可比，
  //    漂移探针因此可以用普通 JSON 序列化比对，不必做"忽略键序"的宽松比较。
  if (Object.hasOwn(input, 'oneOf')) {
    if (Object.hasOwn(input, 'type')) throw authorError(`${path} cannot declare both type and oneOf`)
    if (!Array.isArray(input.oneOf) || input.oneOf.length < 2) {
      throw authorError(`${path}.oneOf must be an array of at least two value schemas`)
    }
    node.oneOf = input.oneOf.map((branch, index) =>
      compileValue(branch, `${path}.oneOf[${index}]`, new Set(VALUE_KEYS), seen),
    )
    copyAnnotations(input, node)
    return node
  }
  const type = Object.hasOwn(input, 'type') ? input.type : undefined
  switch (type) {
    case 'json':
      // 无约束 JSON：只有注解，没有 type（宿主同一个写法）。
      copyAnnotations(input, node)
      return node
    case 'object': {
      if (typeof input.additionalProperties !== 'boolean') {
        throw authorError(`${path}.additionalProperties must be explicitly true or false`)
      }
      node.type = 'object'
      copyAnnotations(input, node)
      node.additionalProperties = input.additionalProperties
      if (Object.hasOwn(input, 'properties')) {
        const compiled = compilePropertyMap(input.properties, `${path}.properties`, seen)
        node.properties = compiled.properties
        if (compiled.required !== undefined) node.required = compiled.required
      }
      return node
    }
    case 'array': {
      node.type = 'array'
      copyAnnotations(input, node)
      if (Object.hasOwn(input, 'items')) {
        node.items = compileValue(input.items, `${path}.items`, new Set(VALUE_KEYS), seen)
      }
      return node
    }
    case 'string':
    case 'number':
    case 'integer':
    case 'boolean':
    case 'null': {
      node.type = type
      copyAnnotations(input, node)
      if (Object.hasOwn(input, 'enum')) {
        if (!Array.isArray(input.enum) || input.enum.length === 0) {
          throw authorError(`${path}.enum must be a non-empty array of scalar values`)
        }
        node.enum = [...input.enum]
      }
      if (Object.hasOwn(input, 'const')) node.const = input.const
      return node
    }
    default:
      throw authorError(`${path}.type must be string/number/integer/boolean/null/array/object/json, or use oneOf`)
  }
}

/**
 * 编译工具的 `parameters`（隐式开放对象根：不加 `additionalProperties`）。
 * @param {object} spec - `{ 参数名: 作者面节点 }`
 * @returns {object} `{ type:'object', properties, required? }`
 */
export function compileParameters(spec) {
  const compiled = compilePropertyMap(spec, 'parameters')
  return {
    type: 'object',
    properties: compiled.properties,
    ...(compiled.required === undefined ? {} : { required: compiled.required }),
  }
}

/**
 * 编译 `output.schema`（值根：根上不许写 `required`）。
 * @param {object} spec - 作者面节点
 * @returns {object} 受支持的 raw JSON Schema
 */
export function compileValueSchema(spec) {
  return compileValue(spec, 'schema', new Set(VALUE_KEYS))
}

/** 有限、非 -0 的 JSON 数字（宿主 `walkJsonValue` 的口径）。 */
function isJsonNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) && !Object.is(value, -0)
}

/** 普通对象（宿主 `hasPlainObjectPrototype` 的口径：只认 Object.prototype / null 原型）。 */
function isPlainObject(value) {
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

/** 普通数组（宿主 `hasPlainArrayPrototype` 的口径：只认 Array.prototype，子类数组不算）。 */
function isPlainArray(value) {
  return Object.getPrototypeOf(value) === Array.prototype
}

/**
 * 无损 JSON 值（宿主 `isJsonValue` 的口径：拒绝 undefined/函数/BigInt/NaN/±Infinity/-0/稀疏数组/环）。
 * @param {unknown} value - 待检值
 * @param {Set<object>} ancestors - 当前路径上的祖先（查环）
 * @returns {boolean}
 */
function isJsonValue(value, ancestors = new Set()) {
  if (value === null) return true
  const type = typeof value
  if (type === 'boolean' || type === 'string') return true
  if (type === 'number') return isJsonNumber(value)
  if (type !== 'object') return false
  if (ancestors.has(value)) return false
  if (Array.isArray(value)) {
    if (!isPlainArray(value)) return false
    if (Reflect.ownKeys(value).length !== value.length + 1) return false
    ancestors.add(value)
    for (let index = 0; index < value.length; index += 1) {
      if (!Object.hasOwn(value, index)) return false
      if (!isJsonValue(value[index], ancestors)) return false
    }
    ancestors.delete(value)
    return true
  }
  if (!isPlainObject(value)) return false
  ancestors.add(value)
  for (const key of Object.keys(value)) {
    if (!isJsonValue(value[key], ancestors)) return false
  }
  ancestors.delete(value)
  return true
}

/** 空路径 → `arguments`（与宿主 `diagnosticPath` 一致）。 */
function diagnosticPath(path) {
  return path === '' ? 'arguments' : path
}

/** 对象属性路径：根层直接 `key`（与宿主 `propertyPath` 一致）。 */
function propertyPath(path, key) {
  return path === '' ? key : `${path}.${key}`
}

/** 标量 enum/const 检查（宿主 `checkScalarValue` 同文案）。 */
function checkScalarValue(node, value, path) {
  const violations = []
  if (Array.isArray(node.enum) && !node.enum.includes(value)) {
    violations.push(`"${diagnosticPath(path)}" must be one of ${JSON.stringify(node.enum)}`)
  }
  if (Object.hasOwn(node, 'const') && value !== node.const) {
    violations.push(`"${diagnosticPath(path)}" must be ${JSON.stringify(node.const)}`)
  }
  return violations
}

/**
 * 校验一个值（宿主 `checkValue` 的递归版：同样的判据、同样的文案与顺序）。
 * @param {object} node - raw JSON Schema 节点
 * @param {unknown} value - 待检值
 * @param {string} path - 诊断路径（根层传 ''）
 * @returns {string[]} 违规描述；空数组＝合法
 */
function checkValue(node, value, path) {
  if (Array.isArray(node.oneOf)) {
    const matched = node.oneOf.filter((branch) => checkValue(branch, value, path).length === 0).length
    if (matched === 1) return []
    return [`"${diagnosticPath(path)}" must match exactly one oneOf branch (matched ${matched})`]
  }
  const type = node.type
  if (type === undefined) {
    return isJsonValue(value) ? [] : [`"${diagnosticPath(path)}" must be a lossless JSON value`]
  }
  switch (type) {
    case 'object': {
      if (!isRecord(value) || !isPlainObject(value)) return [`"${diagnosticPath(path)}" must be an object`]
      const properties = isRecord(node.properties) ? node.properties : {}
      const required = Array.isArray(node.required) ? node.required : []
      const violations = []
      for (const key of required) {
        if (!Object.hasOwn(value, key) || value[key] === undefined) {
          violations.push(`missing required property "${propertyPath(path, key)}"`)
        }
      }
      for (const [key, child] of Object.entries(properties)) {
        if (!Object.hasOwn(value, key) || value[key] === undefined) continue
        violations.push(...checkValue(child, value[key], propertyPath(path, key)))
      }
      if (node.additionalProperties === false) {
        for (const key of Object.keys(value)) {
          if (!Object.hasOwn(properties, key)) {
            violations.push(`"${propertyPath(path, key)}" is not a declared property (additionalProperties: false)`)
          }
        }
      }
      if (violations.length === 0 && !isJsonValue(value)) {
        return [`"${diagnosticPath(path)}" must be a lossless JSON object`]
      }
      return violations
    }
    case 'array': {
      if (!Array.isArray(value)) return [`"${diagnosticPath(path)}" must be an array`]
      const violations = []
      if (Object.hasOwn(node, 'items')) {
        // 🔴 跳过稀疏洞：宿主走 `flatMap`，洞不进元素校验，由下面的"dense"判据统一报。
        for (let index = 0; index < value.length; index += 1) {
          if (!Object.hasOwn(value, index)) continue
          violations.push(...checkValue(node.items, value[index], `${path}[${index}]`))
        }
      }
      if (violations.length === 0 && !isJsonValue(value)) {
        return [`"${diagnosticPath(path)}" must be a dense lossless JSON array`]
      }
      return violations
    }
    case 'string':
      return typeof value === 'string'
        ? checkScalarValue(node, value, path)
        : [`"${diagnosticPath(path)}" must be a string`]
    case 'number':
      if (typeof value !== 'number') return [`"${diagnosticPath(path)}" must be a number`]
      return isJsonNumber(value)
        ? checkScalarValue(node, value, path)
        : [`"${diagnosticPath(path)}" must be a finite JSON number`]
    case 'integer':
      return isJsonNumber(value) && Number.isInteger(value)
        ? checkScalarValue(node, value, path)
        : [`"${diagnosticPath(path)}" must be an integer`]
    case 'boolean':
      return typeof value === 'boolean'
        ? checkScalarValue(node, value, path)
        : [`"${diagnosticPath(path)}" must be a boolean`]
    case 'null':
      return value === null ? checkScalarValue(node, value, path) : [`"${diagnosticPath(path)}" must be null`]
    default:
      throw new Error(`toolshape: unsupported schema type ${JSON.stringify(type)}`)
  }
}

/**
 * 校验模型给的参数（宿主 `validateArgs` 的等价物）。
 * @param {object} parameters - `compileParameters` 的产物
 * @param {unknown} args - 待检参数
 * @returns {string[]} 违规描述；空数组＝合法
 */
export function validateArgs(parameters, args) {
  return checkValue(parameters, args, '')
}

/**
 * 定义一个工具：作者面声明 → `ctx.tools.register()` 可接受的 definition。
 *
 * 🔴 不做注册、不碰 ctx（宿主 `defineTool` 也不做）：本函数只是**编译 + 包装**。
 * @param {object} options - `{ name, description, parameters, output:{schema,render,presentationMeta?}, execute, ... }`
 * @returns {object} 注册用的 definition
 */
export function defineTool(options) {
  const userExecute = options.execute
  const userFinalizeContent = options.finalizeContent
  const userProjectContent = options.projectContent
  const userRender = options.output?.render
  const userPresentationMeta = options.output?.presentationMeta
  const userPresentCall = options.presentCall
  const userPresentResult = options.presentResult
  const userIsConcurrencySafe = options.isConcurrencySafe
  if (options.timeoutMs !== undefined && (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0)) {
    throw new Error(`defineTool(${options.name}): timeoutMs must be a positive finite number`)
  }
  if (typeof userRender !== 'function') {
    throw new TypeError(`tool "${options.name}" must declare output { schema, render, presentationMeta? }`)
  }
  const parameters = compileParameters(options.parameters ?? {})
  const outputSchema = compileValueSchema(options.output.schema)
  const validate = (args) => validateArgs(parameters, args)
  const tool = {
    name: options.name,
    description: options.description,
    parameters,
    output: {
      schema: outputSchema,
      render: (args, value) => userRender(args, value),
      ...(userPresentationMeta === undefined
        ? {}
        : { presentationMeta: (args, value) => userPresentationMeta(args, value) }),
    },
    ...(options.deferLoading === true ? { deferLoading: options.deferLoading } : {}),
    ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
    async execute(args, exec) {
      const violations = validate(args)
      if (violations.length > 0) throw new ToolArgsError(violations)
      return userExecute(args, exec)
    },
  }
  if (userProjectContent) tool.projectContent = (exec, result) => userProjectContent(exec, result)
  if (userFinalizeContent) tool.finalizeContent = (exec, result) => userFinalizeContent(exec, result)
  if (userPresentCall) {
    tool.presentCall = (args) => (validate(args).length > 0 ? undefined : userPresentCall(args))
  }
  if (userPresentResult) {
    tool.presentResult = (args, result) => (validate(args).length > 0 ? undefined : userPresentResult(args, result))
  }
  if (userIsConcurrencySafe) {
    tool.isConcurrencySafe = (args) => (validate(args).length > 0 ? false : userIsConcurrencySafe(args))
  }
  return tool
}
