/**
 * toolsSchema.js — Protocol v2 前端單一真相源（P0 地基）
 *
 * 本檔的 TOOLS_SCHEMA 由 tools/jijun-ai-training/tools.schema.json 同步生成
 * （同步腳本：gen/gen_js_tools.py，標記區段內內容勿手改）。
 * 改動 tool 定義請改 training repo 的 tools.schema.json 後跑同步腳本。
 *
 * 提供：
 * - TOOLS_SCHEMA：6 個 tool 定義（add_record/transfer/add_debt/settle_debt/add_recurring/query_stats）
 * - buildSystemPrompt(toolNames, refDate, enums, opts)：組裝 system prompt
 *   （v1 單工具 = 位元對齊現行 aiService 輸出；多工具 = JSON 陣列）
 * - parseToolCalls(text, ctx)：解析模型輸出為 1..N 個已驗證的 tool call
 * - validateCall(name, args, ctx)：schema 驅動驗證（static enum / 必填 / 型別 / 動態 enum 模糊匹配）
 * - fuzzyMatch / capEnum：動態 enum 兜底工具
 *
 * 設計決策（docs/p0-protocol-v2-spec.md，2026-08-21 已批核）：
 * 1. 多工具 prompt 用 JSON 陣列；v2 前綴帶星期；bare-args 容錯保留（僅 add_record）
 * 2. 動態 enum miss → 模糊匹配命中則 ok（附 resolvedFrom），未命中 → needs_confirmation（不是 invalid）
 * 3. 靜態檢查失敗（必填/型別/static enum/金額>0）→ invalid；invalid/needs_confirmation 絕不自動執行
 * 4. Compressed 軌（[AMT][CAT]...）：研究用，僅 add_record 單 call
 *
 * 注意：add_record.date 的 description 用「前端變體」（ISO 8601 格式日期，例如 YYYY-MM-DD），
 * 與訓練端「僅日期精度」變體不同——兩者皆為 v1 凍結位元，差異記錄於 p0-protocol-v2-spec.md §1。
 */

export const TOOLS_SCHEMA = {
    protocol: 'jijun-tool-calling',
    version: '2.0-draft',
    // BEGIN GENERATED FROM tools.schema.json (gen/gen_js_tools.py) — DO NOT EDIT MANUALLY
    tools: [
    {
        name: "add_record",
        description: "新增一筆記帳記錄",
        phase: "v1",
        kind: "action",
        parameters:         {
            type: "object",
            properties:             {
                amount:                 {
                    type: "number",
                },
                category:                 {
                    type: "string",
                    enum_source: "category",
                },
                account:                 {
                    type: "string",
                    enum_source: "account",
                },
                description:                 {
                    type: "string",
                },
                type:                 {
                    type: "string",
                    enum: ["expense", "income"],
                },
                date:                 {
                    type: "string",
                    description: "ISO 8601 格式日期，例如 YYYY-MM-DD",
                },
            },
            required: ["amount", "category", "account", "type", "date"],
        },
        validation:         {
            amount: "gt0",
            date: "yyyy-mm-dd",
            additional_properties: false,
            note: "validation 欄位只供 validator 使用，絕不出現在 prompt 的 rendered schema 中（保持 prompt 位元穩定）",
            runtime_optional: ["date"],
        },
    },
    {
        name: "transfer",
        description: "在兩個帳戶之間轉帳",
        phase: "p1",
        kind: "action",
        parameters:         {
            type: "object",
            properties:             {
                from_account:                 {
                    type: "string",
                    enum_source: "account",
                },
                to_account:                 {
                    type: "string",
                    enum_source: "account",
                },
                amount:                 {
                    type: "number",
                },
                description:                 {
                    type: "string",
                },
                date:                 {
                    type: "string",
                    description: "ISO 8601 格式日期，僅日期精度，例如 YYYY-MM-DD",
                },
            },
            required: ["from_account", "to_account", "amount", "date"],
        },
        validation:         {
            amount: "gt0",
            date: "yyyy-mm-dd",
            additional_properties: false,
            custom: ["from_account != to_account"],
            runtime_optional: ["date"],
        },
    },
    {
        name: "add_debt",
        description: "記錄借出或借入的欠款",
        phase: "p1",
        kind: "action",
        parameters:         {
            type: "object",
            properties:             {
                contact:                 {
                    type: "string",
                    enum_source: "contact",
                },
                amount:                 {
                    type: "number",
                },
                direction:                 {
                    type: "string",
                    enum: ["lend", "borrow"],
                    description: "lend=借出（對方欠我）, borrow=借入（我欠對方）",
                },
                description:                 {
                    type: "string",
                },
                date:                 {
                    type: "string",
                    description: "ISO 8601 格式日期，僅日期精度，例如 YYYY-MM-DD",
                },
            },
            required: ["contact", "amount", "direction", "date"],
        },
        validation:         {
            amount: "gt0",
            date: "yyyy-mm-dd",
            additional_properties: false,
            runtime_optional: ["date"],
        },
    },
    {
        name: "settle_debt",
        description: "記錄還款（部分或全額償還欠款）",
        phase: "p1",
        kind: "action",
        parameters:         {
            type: "object",
            properties:             {
                contact:                 {
                    type: "string",
                    enum_source: "contact",
                },
                amount:                 {
                    type: "number",
                },
                description:                 {
                    type: "string",
                },
                date:                 {
                    type: "string",
                    description: "ISO 8601 格式日期，僅日期精度，例如 YYYY-MM-DD",
                },
            },
            required: ["contact", "amount", "date"],
        },
        validation:         {
            amount: "gt0",
            date: "yyyy-mm-dd",
            additional_properties: false,
            runtime_optional: ["date"],
        },
    },
    {
        name: "add_recurring",
        description: "新增週期性交易（固定日期 repeating 的支出或收入）",
        phase: "p2",
        kind: "action",
        parameters:         {
            type: "object",
            properties:             {
                amount:                 {
                    type: "number",
                },
                category:                 {
                    type: "string",
                    enum_source: "category",
                },
                account:                 {
                    type: "string",
                    enum_source: "account",
                },
                schedule:                 {
                    type: "string",
                    enum: ["monthly", "weekly"],
                    description: "monthly=每月, weekly=每週",
                },
                schedule_value:                 {
                    type: "integer",
                    minimum: 1,
                    maximum: 28,
                    description: "monthly: 每月第幾號 (1-28); weekly: 星期幾 (1=星期一, 7=星期日)",
                },
                type:                 {
                    type: "string",
                    enum: ["expense", "income"],
                },
                description:                 {
                    type: "string",
                },
                date:                 {
                    type: "string",
                    description: "ISO 8601 格式日期，僅日期精度，例如 YYYY-MM-DD（首次交易日期）",
                },
            },
            required: ["amount", "category", "account", "schedule", "schedule_value", "type", "date"],
        },
        validation:         {
            amount: "gt0",
            date: "yyyy-mm-dd",
            additional_properties: false,
            note: "yearly 暫緩：需 MM-DD 字串與整數混合型別，留 P2 再決策",
            runtime_optional: ["date"],
        },
    },
    {
        name: "query_stats",
        description: "查詢統計資料（由 App 端計算並顯示，不建立任何紀錄）",
        phase: "p3",
        kind: "query",
        parameters:         {
            type: "object",
            properties:             {
                metric:                 {
                    type: "string",
                    enum: ["total", "by_category", "top_expenses"],
                    description: "total=總額, by_category=指定分類金額, top_expenses=Top N 支出",
                },
                value:                 {
                    type: "string",
                    enum_source: "category",
                    description: "metric=by_category 時為分類名稱",
                },
                period:                 {
                    type: "string",
                    enum: ["this_week", "last_week", "this_month", "last_month", "this_year", "last_year"],
                },
                account:                 {
                    type: "string",
                    enum_source: "account",
                },
            },
            required: ["metric", "period"],
        },
        validation:         {
            additional_properties: false,
            conditional: [            {
                when:                 {
                    metric: "by_category",
                },
                required: ["value"],
                message: "metric=by_category 時缺少 value 欄位",
            }],
            note: "period 一律用 enum，模型不算日期；app 端用既有 getCurrentDateAnchor 同一套邏輯解析",
        },
    }
    ],
    contexts: {
    add_page: ["add_record", "transfer", "add_debt", "settle_debt", "add_recurring"],
    stats_page: ["query_stats"],
},
    dynamicEnumSources: {
    category:     {
        maxItems: null,
    },
    account:     {
        maxItems: null,
    },
    contact:     {
        maxItems: 12,
    },
}
    // END GENERATED FROM tools.schema.json
}

/** @type {Object<string, object>} tool 名稱 → 定義 */
export const TOOLS_BY_NAME = Object.fromEntries(TOOLS_SCHEMA.tools.map(t => [t.name, t]))

const WEEKDAYS = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六']

/**
 * 把 LLM 常見的日期變體標準化為補零的 YYYY-MM-DD。
 * 支援：2026-9-2（缺零）、2026/9/2、ISO 帶時間戳（2026-09-02T08:00:00 / +08:00）、
 * 2026-09-02 08:00:00、epoch 毫秒數字（1759996800000 或 "1759996800000"）。
 * 用 UTC 組字串（不做時區轉換），避免同一輸入在不同時區裝置上標準化出不同日期。
 * @returns {string|null} 可解析時回傳 YYYY-MM-DD，否則 null
 */
function normalizeDate(value) {
    // 數字 / 純數字字串的 epoch 毫秒
    const asNumber = typeof value === 'number' ? value : /^\d{12,14}$/.test(String(value).trim()) ? Number(value) : NaN
    if (!Number.isNaN(asNumber) && asNumber > 1000000000000) {
        const d = new Date(asNumber)
        if (!Number.isNaN(d.getTime())) {
            return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
        }
    }
    const s = String(value).trim()
    const m = /^(\d{4})[-/年.](\d{1,2})[-/月.](\d{1,2})日?/.exec(s)
    if (!m) return null
    const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])))
    if (
        d.getUTCFullYear() !== Number(m[1]) ||
        d.getUTCMonth() !== Number(m[2]) - 1 ||
        d.getUTCDate() !== Number(m[3])
    ) {
        return null
    }
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
}

/**
 * 把 schema 定義渲染成 prompt 用的結構（enum_source → 實際清單）
 * @private
 */
function renderToolDef(tool, enums, descriptions = {}) {
    const properties = {}
    for (const [key, prop] of Object.entries(tool.parameters.properties)) {
        const rendered = {}
        for (const [k, v] of Object.entries(prop)) {
            if (k === 'enum_source') {
                const pool = enums[v]
                if (!Array.isArray(pool)) {
                    throw new Error(`tool ${tool.name} 欄位 ${key} 需要動態 enum 池 '${v}'，但未提供`)
                }
                rendered.enum = pool
            } else {
                rendered[k] = v
            }
        }
        // opts.descriptions 注入的前端變體欄位描述（覆蓋既有 description）
        if (descriptions[key] != null) rendered.description = descriptions[key]
        properties[key] = rendered
    }
    return {
        name: tool.name,
        description: tool.description,
        parameters: {
            type: 'object',
            properties,
            required: [...tool.parameters.required]
        }
    }
}

/**
 * 組裝 system prompt（位元穩定）
 * @param {string[]} toolNames - tool 名稱清單（順序 = prompt 出現順序；單個 = v1 物件格式，多個 = JSON 陣列）
 * @param {Date} refDate - 錨定日期
 * @param {Object<string, string[]>} [enums] - {category, account, contact}（只含被用到的）
 * @param {object} [opts]
 * @param {boolean} [opts.weekday=true] - 前綴是否帶（星期X）（v2 決策：帶）
 * @param {boolean} [opts.compact=true] - JSON 是否無空格（true = 對齊 JSON.stringify 生產位元）
 * @returns {string}
 */
export function buildSystemPrompt(toolNames, refDate, enums = {}, opts = {}) {
    if (!Array.isArray(toolNames) || toolNames.length === 0) {
        throw new Error('buildSystemPrompt: toolNames 至少需要一個 tool')
    }
    const weekday = opts.weekday !== false
    const ruleText = typeof opts.ruleText === 'string' ? opts.ruleText : ''
    const descriptions = opts.descriptions && typeof opts.descriptions === 'object' ? opts.descriptions : {}
    const dateObj = refDate instanceof Date ? refDate : new Date(refDate)
    const y = dateObj.getFullYear()
    const m = String(dateObj.getMonth() + 1).padStart(2, '0')
    const d = String(dateObj.getDate()).padStart(2, '0')
    const weekdayPart = weekday ? `（${WEEKDAYS[dateObj.getDay()]}）` : ''
    const defs = toolNames.map(name => {
        const tool = TOOLS_BY_NAME[name]
        if (!tool) throw new Error(`buildSystemPrompt: 未知 tool '${name}'`)
        return renderToolDef(tool, enums, descriptions[name] || {})
    })
    const toolsJson = JSON.stringify(defs.length === 1 ? defs[0] : defs)
    return `今天是 ${y}-${m}-${d}${weekdayPart}。你是一個記帳助理。${ruleText}你被賦予了以下 tools:\n${toolsJson}`
}

/** 剔除思考鏈標籤（相容 DeepSeek-R1 / Qwen3 推理系列，與 v1 邏輯一致） */
export function stripThinkingTags(text) {
    if (!text || typeof text !== 'string') return ''
    return text
        .replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, '')
        .replace(/^[\s\S]*?<\/think(?:ing)?>/i, '')
        .trim()
}

/**
 * 模糊匹配動態 enum（normalization → 子字串 → 編輯距離 ≤ 1）
 * @param {string} value - 模型輸出的值
 * @param {string[]} pool - 合法值清單
 * @returns {string|null} 池內最接近的值，或 null
 */
export function fuzzyMatch(value, pool) {
    const nv = normalizeEnum(value)
    if (!nv) return null
    for (const p of pool) {
        if (normalizeEnum(p) === nv) return p
    }
    for (const p of pool) {
        const np = normalizeEnum(p)
        if (np.length >= 2 && (np.includes(nv) || nv.includes(np))) return p
    }
    let best = null
    let bestDist = 2
    for (const p of pool) {
        const dist = levenshtein(nv, normalizeEnum(p))
        if (dist < bestDist) {
            bestDist = dist
            best = p
        }
    }
    return bestDist <= 1 ? best : null
}

function normalizeEnum(s) {
    return String(s).trim().toLowerCase().replace(/\s+/g, '')
}

function levenshtein(a, b) {
    if (a === b) return 0
    if (!a.length) return b.length
    if (!b.length) return a.length
    let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
    for (let i = 1; i <= a.length; i++) {
        const curr = [i]
        for (let j = 1; j <= b.length; j++) {
            curr[j] = Math.min(
                prev[j] + 1,
                curr[j - 1] + 1,
                prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
            )
        }
        prev = curr
    }
    return prev[b.length]
}

/** 動態 enum 截斷（contact top-12 決策） */
export function capEnum(list, maxItems) {
    if (!Array.isArray(list)) return list
    return maxItems && list.length > maxItems ? list.slice(0, maxItems) : list
}

/**
 * 驗證單一 tool call（schema 驅動）
 * @param {string} name - tool 名稱
 * @param {object} args - 解析後的參數
 * @param {object} [ctx] - { pools: {category, account, contact}, tools: [string] }
 * @returns {{valid: boolean, needsConfirmation: boolean, issues: string[], resolvedFrom: Object<string, string>}}
 *   valid=false = 靜態檢查失敗（絕不執行）；needsConfirmation=true = 動態 enum 未命中（UI 讓使用者選）
 */
export function validateCall(name, args, ctx = {}) {
    const issues = []
    const resolvedFrom = {}
    const tool = TOOLS_BY_NAME[name]
    if (!tool) {
        return { valid: false, needsConfirmation: false, issues: [`未知 tool: ${name}`], resolvedFrom }
    }
    if (typeof args !== 'object' || args === null || Array.isArray(args)) {
        return { valid: false, needsConfirmation: false, issues: ['args 不是物件'], resolvedFrom }
    }

    const { properties, required } = tool.parameters
    const runtimeOptional = new Set((tool.validation && tool.validation.runtime_optional) || [])
    for (const key of required) {
        if (runtimeOptional.has(key)) continue // 訓練資料必填，但運行時允許缺省（app 端 fallback）
        if (args[key] === undefined || args[key] === null || args[key] === '') {
            issues.push(`缺少必要欄位: ${key}`)
        }
    }
    const extras = Object.keys(args).filter(k => !(k in properties))
    if (extras.length) {
        issues.push(`未預期欄位: ${extras.join(', ')}`)
    }

    for (const [key, prop] of Object.entries(properties)) {
        // LLM 原始輸入：type coercion / 日期標準化後 resolvedFrom 仍以它為準
        const originalInput = args[key]
        let value = args[key]
        if (value === undefined || value === null || value === '') continue
        if (prop.type === 'number' && (typeof value !== 'number' || !Number.isFinite(value))) {
            issues.push(`欄位 ${key} 必須是數值`)
            continue
        }
        if (prop.type === 'integer' && (typeof value !== 'number' || !Number.isInteger(value))) {
            issues.push(`欄位 ${key} 必須是整數`)
            continue
        }
        if (prop.type === 'string' && typeof value !== 'string') {
            // agy M3：LLM 偶爾把 date 輸出成 epoch 毫秒數字 → 統一轉字串後
            // 走日期標準化（下方 normalizeDate 處理）。其他 string 欄位仍拒絕。
            if (key === 'date' && typeof value === 'number' && Number.isFinite(value)) {
                args[key] = String(value)
                value = args[key]
            } else {
                issues.push(`欄位 ${key} 必須是字串`)
                continue
            }
        }
        if (typeof value === 'number') {
            if (prop.minimum !== undefined && value < prop.minimum) {
                issues.push(`欄位 ${key} 必須 ≥ ${prop.minimum}`)
            }
            if (prop.maximum !== undefined && value > prop.maximum) {
                issues.push(`欄位 ${key} 必須 ≤ ${prop.maximum}`)
            }
        }
        // type coercion（epoch 數字→字串）後，value 為字串；resolvedFrom 一律
        // 記錄 LLM 原始輸入（originalInput）
        if (typeof value !== 'string') continue

        if (prop.enum_source) {
            const pool = (ctx.pools || {})[prop.enum_source] || []
            if (pool.length && !pool.includes(value)) {
                const matched = fuzzyMatch(value, pool)
                if (matched) {
                    args[key] = matched
                    resolvedFrom[key] = value
                } else {
                    issues.push(`needs_confirmation:${key}=${value}`)
                }
            }
        } else if (prop.enum && !prop.enum.includes(value)) {
            issues.push(`欄位 ${key} 不在合法清單: ${value}`)
        }
        if (key === 'date') {
            // agy M3：DATE_RE 只驗形狀不驗語意（2026-13-01 / 2026-00-01 會過），
            // 且 LLM 常見變體（2026-9-2 / ISO 帶時間戳 / 斜線）會被整批拒絕。
            // 改以 normalizeDate 為單一真相源：可解析 → 標準化補零（含語意
            // round-trip 校驗，攔 2026-02-30 / 13 月）；不可解析才報錯。
            const normalized = normalizeDate(value)
            if (normalized) {
                if (normalized !== value) {
                    args[key] = normalized
                    resolvedFrom[key] = originalInput
                }
            } else {
                issues.push(`日期格式無效: ${value} (必須為 YYYY-MM-DD)`)
            }
        }
    }

    const validation = tool.validation || {}
    if (validation.amount === 'gt0' && typeof args.amount === 'number' && !(args.amount > 0)) {
        issues.push('金額必須大於 0')
    }
    for (const rule of validation.custom || []) {
        if (rule === 'from_account != to_account'
            && args.from_account !== undefined
            && args.from_account === args.to_account) {
            issues.push('轉帳來源與目標帳戶相同')
        }
    }
    for (const rule of validation.conditional || []) {
        const condMet = Object.entries(rule.when || {}).every(([k, v]) => args[k] === v)
        if (condMet) {
            for (const req of rule.required || []) {
                if (args[req] === undefined || args[req] === null || args[req] === '') {
                    issues.push(rule.message || `缺少欄位: ${req}`)
                }
            }
        }
    }

    const needsConfirmation = issues.some(i => i.startsWith('needs_confirmation:'))
    const valid = !issues.some(i => !i.startsWith('needs_confirmation:'))
    return {
        valid,
        needsConfirmation,
        issues: issues.map(i => i.replace(/^needs_confirmation:/, '')),
        resolvedFrom
    }
}

/**
 * 解析 compressed 軌（[AMT][CAT]...，研究用，僅 add_record 單 call）
 * @private
 */
function parseCompressedArgs(text) {
    const args = {}
    const amt = text.match(/\[AMT\]\s*([0-9.]+)/)
    if (amt) args.amount = Number(amt[1])
    const cat = text.match(/\[CAT\]\s*([^[<]+)/)
    if (cat) args.category = cat[1].trim()
    const acc = text.match(/\[ACC\]\s*([^[<]+)/)
    if (acc) args.account = acc[1].trim()
    const desc = text.match(/\[DESC\]\s*([^[<]*)/)
    if (desc) args.description = desc[1].trim()
    const date = text.match(/\[DATE\]\s*(\d{4}-\d{2}-\d{2})/)
    if (date) args.date = date[1].trim()
    const type = text.match(/\[TYPE\]\s*([^[<]+)/)
    if (type) args.type = type[1].trim()
    return args
}

/**
 * 從文字中找出第一座 balanced JSON 物件（含巢狀大括號，字串內大括號不計）
 * @private
 */
export function extractBalancedJson(text) {
    const start = text.indexOf('{')
    if (start < 0) return null
    let depth = 0
    let inString = false
    let escaped = false
    for (let i = start; i < text.length; i++) {
        const ch = text[i]
        if (inString) {
            if (escaped) escaped = false
            else if (ch === '\\') escaped = true
            else if (ch === '"') inString = false
        } else if (ch === '"') {
            inString = true
        } else if (ch === '{') {
            depth++
        } else if (ch === '}') {
            depth--
            if (depth === 0) return text.slice(start, i + 1)
        }
    }
    // 微截斷容錯：模型因 stop token / max_tokens 剛好在最後幾層大括號前停住時
    // （depth > 0 且不在字串內），補齊閉合括號後再試解析一次。
    if (depth > 0 && !inString) {
        let candidate = text.slice(start)
        for (let d = 0; d < depth; d++) candidate += '}'
        try {
            JSON.parse(candidate)
            return candidate
        } catch (_) {
            // 補齊後仍不合法則放棄（維持回傳 null 的契約）
        }
    }
    return null
}

const TOOL_CALL_RE = /<tool_call>([\s\S]*?)<\/tool_call>/g

/**
 * 把一個 parsed JSON 物件解析成 (name, args)（bare-args 容錯，v1 決策）
 * @private
 * @returns {{name: string, args: object}|null} 無法解析時回傳 null
 */
function resolveParsed(parsed, tools) {
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null
    const name = typeof parsed.name === 'string' && parsed.name ? parsed.name : null
    let rawArgs = parsed.args !== undefined ? parsed.args : parsed.arguments
    // 相容部分模型/OpenAI 風格輸出：args/arguments 為 JSON 字串而非物件
    if (typeof rawArgs === 'string') {
        try {
            rawArgs = JSON.parse(rawArgs)
        } catch (_) {
            rawArgs = null
        }
    }
    let args = rawArgs
    if (args !== undefined && (typeof args !== 'object' || args === null || Array.isArray(args))) {
        args = null
    }
    if (name) {
        if (!args) return null
        return { name, args }
    }
    // 無 name：bare-args 容錯（僅限情境含 add_record）
    if (!tools.includes('add_record')) return null
    // parsed.args/parsed.arguments 皆不存在時，parsed 本身就是 args（v1 bare-args 格式）
    return { name: 'add_record', args: args !== undefined ? args : parsed }
}

/**
 * 解析模型輸出為 1..N 個已驗證 tool call（Protocol v2）
 * @param {string} responseText - 模型原始輸出
 * @param {object} [ctx]
 * @param {Object<string, string[]>} [ctx.pools] - 動態 enum 池（category/account/contact）
 * @param {string[]} [ctx.tools] - 當前情境允許的 tools（預設 ['add_record']，影響 bare-args 容錯）
 * @returns {{calls: Array<{name: string|null, args: object|null, valid: boolean, needsConfirmation: boolean, issues: string[], resolvedFrom: Object<string, string>}>, format: 'json'|'compressed'}}
 * @throws {Error} 完全無法提取時（錯誤訊息與 v1 extractToolCall 對齊）
 */
export function parseToolCalls(responseText, ctx = {}) {
    if (typeof responseText !== 'string' || !responseText.trim()) {
        throw new Error('模型輸出為空')
    }
    const text = stripThinkingTags(responseText)
    const pools = ctx.pools || {}
    const tools = Array.isArray(ctx.tools) && ctx.tools.length ? ctx.tools : ['add_record']
    const calls = []

    // 1. Compressed 軌（研究用，僅 add_record 單 call）
    if (text.includes('[AMT]') || text.includes('[CAT]')) {
        const args = parseCompressedArgs(text)
        const v = validateCall('add_record', args, { pools, tools })
        calls.push({ name: 'add_record', args, ...v })
        return { calls, format: 'compressed' }
    }

    // 2. JSON 軌：全域匹配所有 tool_call block（v1 = 單 block，v2 = 1..N）
    TOOL_CALL_RE.lastIndex = 0
    let m
    while ((m = TOOL_CALL_RE.exec(text)) !== null) {
        let parsed
        try {
            parsed = JSON.parse(m[1].trim())
        } catch (e) {
            const extracted = extractBalancedJson(m[1])
            if (extracted) {
                try {
                    parsed = JSON.parse(extracted)
                } catch (_) {}
            }
            if (!parsed) {
                calls.push({ name: null, args: null, valid: false, needsConfirmation: false, issues: [`解析 JSON 失敗: ${e.message}`], resolvedFrom: {} })
                continue
            }
        }
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
            calls.push({ name: null, args: null, valid: false, needsConfirmation: false, issues: ['tool call 不是 JSON 物件'], resolvedFrom: {} })
            continue
        }
        const resolved = resolveParsed(parsed, tools)
        if (!resolved || !resolved.args) {
            calls.push({
                name: resolved ? resolved.name : null,
                args: null,
                valid: false,
                needsConfirmation: false,
                issues: resolved ? ['缺少 args'] : ['缺少 tool 名稱（bare args 僅限 add_record）'],
                resolvedFrom: {}
            })
            continue
        }
        const v = validateCall(resolved.name, resolved.args, { pools, tools })
        calls.push({ name: resolved.name, args: resolved.args, ...v })
    }

    // 3. 無 tag 或所有 tag 皆無有效 args 時 fallback：balanced 物件（比 v1 的非貪婪 regex 更能吃巢狀結構）
    if (!calls.length || !calls.some(c => c.args)) {
        const jsonStr = extractBalancedJson(text)
        if (jsonStr) {
            let parsed
            try {
                parsed = JSON.parse(jsonStr)
            } catch (e) {
                parsed = null
            }
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                const resolved = resolveParsed(parsed, tools)
                if (resolved && resolved.args) {
                    if (!calls.length) {
                        calls.push({ name: resolved.name, args: resolved.args, ...validateCall(resolved.name, resolved.args, { pools, tools }) })
                    } else {
                        calls.length = 0
                        calls.push({ name: resolved.name, args: resolved.args, ...validateCall(resolved.name, resolved.args, { pools, tools }) })
                    }
                }
            }
        }
    }

    if (!calls.length) {
        throw new Error('無法從 AI 輸出中提取 Tool Call 格式。原始輸出: ' + responseText)
    }
    return { calls, format: 'json' }
}
