/**
 * toolsSchema.test.js — Protocol v2 前端單一真相源（P0）
 *
 * 覆蓋：
 * 1. buildSystemPrompt：v1 單工具位元對齊、多工具 JSON 陣列、enum 注入、contact 截斷
 * 2. parseToolCalls：多筆 tool call、compressed 軌、thinking 標籤、bare-args、未知 tool
 * 3. validateCall：static enum、必填、金額>0、日期格式、動態 enum 模糊匹配、needsConfirmation
 * 4. fuzzyMatch / capEnum
 */
import { describe, it, expect } from 'vitest'
import {
    TOOLS_SCHEMA,
    buildSystemPrompt,
    parseToolCalls,
    validateCall,
    fuzzyMatch,
    capEnum,
    stripThinkingTags
} from '../../src/js/toolsSchema.js'

const CATS = ['餐飲', '交通', '醫療', '薪水', '其他']
const ACCTS = ['現金', '信用卡', 'LINE Pay', '玉山帳戶']
const CONTACTS = ['小明', '阿寶', '小美']
const POOLS = { category: CATS, account: ACCTS, contact: CONTACTS }
const ADD_PAGE_TOOLS = ['add_record', 'transfer', 'add_debt', 'settle_debt']

describe('toolsSchema - buildSystemPrompt', () => {
    it('v1 單工具模式：與現行 aiService 輸出位元一致（compact JSON + 星期前綴）', () => {
        const cats = ['餐飲', '交通', '貓咪用品']
        const accts = ['現金', '貓貓儲值卡']
        const actual = buildSystemPrompt(['add_record'], new Date('2026-08-03T10:00:00'), {
            category: cats, account: accts
        })
        const toolDef = {
            name: 'add_record',
            description: '新增一筆記帳記錄',
            parameters: {
                type: 'object',
                properties: {
                    amount: { type: 'number' },
                    category: { type: 'string', enum: cats },
                    account: { type: 'string', enum: accts },
                    description: { type: 'string' },
                    type: { type: 'string', enum: ['expense', 'income'] },
                    date: { type: 'string', description: 'ISO 8601 格式日期，例如 YYYY-MM-DD' }
                },
                required: ['amount', 'category', 'account', 'type', 'date']
            }
        }
        expect(actual).toBe(
            '今天是 2026-08-03（星期一）。你是一個記帳助理。你被賦予了以下 tools:\n' + JSON.stringify(toolDef)
        )
    })

    it('多工具模式：JSON 陣列、順序保留、動態 enum 注入、無 enum_source 洩漏', () => {
        const prompt = buildSystemPrompt(
            ['add_record', 'transfer', 'add_debt', 'settle_debt'],
            new Date('2026-08-21T12:00:00'),
            POOLS
        )
        expect(prompt).toContain('今天是 2026-08-21（星期五）')
        const arr = JSON.parse(prompt.split('\n')[1])
        expect(Array.isArray(arr)).toBe(true)
        expect(arr.map(t => t.name)).toEqual(['add_record', 'transfer', 'add_debt', 'settle_debt'])
        expect(arr[1].parameters.properties.from_account.enum).toEqual(ACCTS)
        expect(arr[2].parameters.properties.contact.enum).toEqual(CONTACTS)
        expect(JSON.stringify(arr)).not.toContain('enum_source')
    })

    it('weekday=false 時前綴無星期（對齊 v1 訓練資料格式）', () => {
        const prompt = buildSystemPrompt(['add_record'], new Date('2026-08-21T12:00:00'), POOLS, { weekday: false })
        expect(prompt.startsWith('今天是 2026-08-21。你是一個記帳助理。')).toBe(true)
        expect(prompt).not.toContain('星期五')
    })

    it('contact 池超過 12 個時由呼叫端 capEnum 截斷', () => {
        const big = Array.from({ length: 20 }, (_, i) => `聯絡人${i}`)
        expect(capEnum(big, 12).length).toBe(12)
        expect(capEnum(big, 12)).toEqual(big.slice(0, 12))
        expect(capEnum(big, null)).toBe(big)
    })

    it('未知 tool 名稱拋錯；缺 enum 池拋錯', () => {
        expect(() => buildSystemPrompt(['nope'], new Date(), POOLS)).toThrow(/未知 tool/)
        expect(() => buildSystemPrompt(['add_record'], new Date(), { category: CATS })).toThrow(/enum 池/)
    })

    // ===== #64 移植：opts.ruleText / opts.descriptions 回歸 =====
    it('opts.ruleText：規則文字注入於「記帳助理。」與「你被賦予」之間', () => {
        const rule = '規則：消費行為 type 必須為 expense；收入才為 income。'
        const prompt = buildSystemPrompt(['add_record'], new Date('2026-08-03T10:00:00'), POOLS, { ruleText: rule })
        expect(prompt).toContain(`你是一個記帳助理。${rule}你被賦予了以下 tools:`)
    })

    it('opts.ruleText：非字串（null/number）時行為與舊版完全一致', () => {
        const base = buildSystemPrompt(['add_record'], new Date('2026-08-03T10:00:00'), POOLS)
        for (const bad of [null, undefined, 123, {}]) {
            expect(buildSystemPrompt(['add_record'], new Date('2026-08-03T10:00:00'), POOLS, { ruleText: bad })).toBe(base)
        }
        expect(base).toContain('你是一個記帳助理。你被賦予了以下 tools:')
    })

    it('opts.descriptions：單工具模式覆蓋欄位 description（其他欄位不受影響）', () => {
        const prompt = buildSystemPrompt(['add_record'], new Date('2026-08-03T10:00:00'), POOLS, {
            descriptions: { add_record: { type: '收支類型：消費填 expense，收入填 income' } }
        })
        const toolDef = JSON.parse(prompt.split('被賦予了以下 tools:\n')[1].trim())
        expect(toolDef.parameters.properties.type.description).toBe('收支類型：消費填 expense，收入填 income')
        // 未覆蓋的欄位保持 schema 原樣（date 有原始 description）
        expect(toolDef.parameters.properties.date.description).toBe('ISO 8601 格式日期，例如 YYYY-MM-DD')
    })

    it('opts.descriptions：多工具模式只注入對應 tool', () => {
        const prompt = buildSystemPrompt(
            ['add_record', 'transfer'],
            new Date('2026-08-21T12:00:00'),
            POOLS,
            { descriptions: { transfer: { amount: '轉帳金額（大於0）' } } }
        )
        const arr = JSON.parse(prompt.split('\n')[1])
        const byName = Object.fromEntries(arr.map(t => [t.name, t]))
        expect(byName.transfer.parameters.properties.amount.description).toBe('轉帳金額（大於0）')
        // add_record 的 amount 原本無 description，不受另一個 tool 的注入影響
        expect(byName.add_record.parameters.properties.amount.description).toBeUndefined()
    })

    it('opts.descriptions：未知 tool 名 / 未知欄位 key 被忽略且不破壞輸出', () => {
        const base = buildSystemPrompt(['add_record'], new Date('2026-08-03T10:00:00'), POOLS)
        const junk = buildSystemPrompt(['add_record'], new Date('2026-08-03T10:00:00'), POOLS, {
            descriptions: { nope: { amount: '不該出現' }, add_record: { nonexist_field: '不該出現' } }
        })
        expect(junk).toBe(base)
    })

    it('opts.descriptions：非 object（字串/陣列）時退回無注入行為', () => {
        const base = buildSystemPrompt(['add_record'], new Date('2026-08-03T10:00:00'), POOLS)
        expect(buildSystemPrompt(['add_record'], new Date('2026-08-03T10:00:00'), POOLS, { descriptions: 'oops' })).toBe(base)
        expect(buildSystemPrompt(['add_record'], new Date('2026-08-03T10:00:00'), POOLS, { descriptions: ['a'] })).toBe(base)
    })
})

describe('toolsSchema - parseToolCalls 多筆解析', () => {
    it('解析 1..N 個 tool_call block（含空白/換行分隔）', () => {
        const text =
            '<tool_call>{"name": "add_record", "args": {"amount": 200, "category": "餐飲", "account": "現金", "type": "expense", "date": "2026-08-21"}}</tool_call>\n' +
            '<tool_call>{"name": "add_record", "args": {"amount": 1200, "category": "餐飲", "account": "信用卡", "description": "聚餐", "type": "expense", "date": "2026-08-21"}}</tool_call>'
        const { calls, format } = parseToolCalls(text, { pools: POOLS, tools: ADD_PAGE_TOOLS })
        expect(format).toBe('json')
        expect(calls).toHaveLength(2)
        expect(calls[0].name).toBe('add_record')
        expect(calls[0].args.amount).toBe(200)
        expect(calls[0].valid).toBe(true)
        expect(calls[1].args.amount).toBe(1200)
        expect(calls[1].args.description).toBe('聚餐')
    })

    it('混合工具：transfer + add_debt 各自解析並通過驗證', () => {
        const text =
            '<tool_call>{"name": "transfer", "args": {"from_account": "現金", "to_account": "玉山帳戶", "amount": 5000, "date": "2026-08-21"}}</tool_call>' +
            '<tool_call>{"name": "add_debt", "args": {"contact": "小明", "amount": 500, "direction": "lend", "date": "2026-08-21"}}</tool_call>'
        const { calls } = parseToolCalls(text, { pools: POOLS, tools: ADD_PAGE_TOOLS })
        expect(calls.map(c => c.name)).toEqual(['transfer', 'add_debt'])
        expect(calls.every(c => c.valid)).toBe(true)
    })

    it('compressed 軌僅 add_record 單 call', () => {
        const { calls, format } = parseToolCalls(
            '<tool_call>[AMT]350[CAT]餐飲[ACC]現金[DESC]午餐[DATE]2026-08-21[TYPE]expense</tool_call>',
            { pools: POOLS, tools: ADD_PAGE_TOOLS }
        )
        expect(format).toBe('compressed')
        expect(calls).toHaveLength(1)
        expect(calls[0].name).toBe('add_record')
        expect(calls[0].args.amount).toBe(350)
        expect(calls[0].valid).toBe(true)
    })

    it('thinking 標籤內的 [AMT] 不誤觸 compressed 軌', () => {
        const text =
            '<thinking>金額 [AMT]999 是錯的，應該是 30</thinking>' +
            '<tool_call>{"name": "add_record", "args": {"amount": 30, "category": "交通", "account": "現金", "type": "expense", "date": "2026-08-21"}}</tool_call>'
        const { calls, format } = parseToolCalls(text, { pools: POOLS, tools: ADD_PAGE_TOOLS })
        expect(format).toBe('json')
        expect(calls[0].args.amount).toBe(30)
    })

    it('bare-args（無 name envelope）在 add_record 情境下容錯', () => {
        const { calls } = parseToolCalls(
            '<tool_call>{"amount": 100, "category": "餐飲", "account": "現金", "type": "expense"}</tool_call>',
            { pools: POOLS, tools: ['add_record'] }
        )
        expect(calls).toHaveLength(1)
        expect(calls[0].name).toBe('add_record')
        expect(calls[0].args.amount).toBe(100)
    })

    it('無 tag 時 fallback 到 balanced JSON 物件（含巢狀大括號）', () => {
        const text = '好的，我幫你記：{"name": "add_record", "args": {"amount": 80, "category": "餐飲", "account": "信用卡", "description": "含{括號}測試", "type": "expense", "date": "2026-08-21"}}'
        const { calls } = parseToolCalls(text, { pools: POOLS, tools: ADD_PAGE_TOOLS })
        expect(calls).toHaveLength(1)
        expect(calls[0].args.amount).toBe(80)
        expect(calls[0].args.description).toBe('含{括號}測試')
    })

    it('完全無法提取時拋錯（訊息與 v1 對齊）', () => {
        expect(() => parseToolCalls('這是一句普通的話')).toThrow('無法從 AI 輸出中提取 Tool Call 格式')
        expect(() => parseToolCalls('')).toThrow('模型輸出為空')
        expect(() => parseToolCalls('   ')).toThrow('模型輸出為空')
    })

    it('JSON 損毀的 block 標記 invalid 而非整體拋錯', () => {
        const text =
            '<tool_call>{"name": "add_record", "args": {"amount": 100, "category": </tool_call>' +
            '<tool_call>{"name": "add_record", "args": {"amount": 200, "category": "餐飲", "account": "現金", "type": "expense", "date": "2026-08-21"}}</tool_call>'
        const { calls } = parseToolCalls(text, { pools: POOLS, tools: ADD_PAGE_TOOLS })
        expect(calls).toHaveLength(2)
        expect(calls[0].valid).toBe(false)
        expect(calls[0].issues[0]).toContain('解析 JSON 失敗')
        expect(calls[1].valid).toBe(true)
    })

    it('tool_call 內含 markdown codeblock 能被 extractBalancedJson 成功修復解析', () => {
        const text = '<tool_call>```json\n{"name": "add_record", "args": {"amount": 50, "category": "餐飲", "account": "現金", "type": "expense", "date": "2026-08-21"}}\n```</tool_call>'
        const { calls } = parseToolCalls(text, { pools: POOLS, tools: ADD_PAGE_TOOLS })
        expect(calls).toHaveLength(1)
        expect(calls[0].valid).toBe(true)
        expect(calls[0].args.amount).toBe(50)
    })

    it('tag 內為無效純文字但外部有合法 JSON 時能 fallback 到 balanced JSON', () => {
        const text = '<tool_call>記帳明細如下：</tool_call> {"name": "add_record", "args": {"amount": 75, "category": "餐飲", "account": "現金", "type": "expense", "date": "2026-08-21"}}'
        const { calls } = parseToolCalls(text, { pools: POOLS, tools: ADD_PAGE_TOOLS })
        expect(calls).toHaveLength(1)
        expect(calls[0].valid).toBe(true)
        expect(calls[0].args.amount).toBe(75)
    })
})

describe('toolsSchema - validateCall 驗證規則', () => {
    it('static enum 違規 → invalid', () => {
        const r = validateCall('add_record', {
            amount: 100, category: '餐飲', account: '現金', type: 'invalid_type', date: '2026-08-21'
        }, { pools: POOLS })
        expect(r.valid).toBe(false)
        expect(r.issues.join()).toContain('type 不在合法清單')
    })

    it('金額 ≤ 0 → invalid（金額必須大於 0）', () => {
        const r = validateCall('add_record', {
            amount: -50, category: '餐飲', account: '現金', type: 'expense', date: '2026-08-21'
        }, { pools: POOLS })
        expect(r.valid).toBe(false)
        expect(r.issues.join()).toContain('金額必須大於 0')
    })

    it('日期格式無效 → invalid；日期缺省 → 運行時允許（runtime_optional）', () => {
        const bad = validateCall('add_record', {
            amount: 100, category: '餐飲', account: '現金', type: 'expense', date: '2026/02/30'
        }, { pools: POOLS })
        expect(bad.valid).toBe(false)
        expect(bad.issues.join()).toContain('日期格式無效')

        const noDate = validateCall('add_record', {
            amount: 100, category: '餐飲', account: '現金', type: 'expense'
        }, { pools: POOLS })
        expect(noDate.valid).toBe(true)
    })

    it('日期變體自動標準化為補零 YYYY-MM-DD（agy M3：LLM 容錯）', () => {
        const cases = [
            ['2026-9-2', '2026-09-02'],
            ['2026/9/2', '2026-09-02'],
            ['2026.9.2', '2026-09-02'],
            ['2026年9月2日', '2026-09-02'],
            ['2026-09-02T08:30:00', '2026-09-02'],
            ['2026-09-02T08:30:00+08:00', '2026-09-02'],
            ['2026-09-02 08:30:00', '2026-09-02'],
            [1788307200000, '2026-09-02'],
        ]
        for (const [input, expected] of cases) {
            const args = {
                amount: 100, category: '餐飲', account: '現金', type: 'expense', date: input,
            }
            const r = validateCall('add_record', args, { pools: POOLS })
            expect(r.valid, `input=${JSON.stringify(input)}`).toBe(true)
            expect(args.date, `input=${JSON.stringify(input)}`).toBe(expected)
            expect(r.resolvedFrom.date, `input=${JSON.stringify(input)}`).toBe(input)
        }
        // 真正無效的日期仍須拒絕
        const invalid = ['2026-13-01', '2026/02/30', 'abcdef', '09/02/2026']
        for (const input of invalid) {
            const r = validateCall('add_record', {
                amount: 100, category: '餐飲', account: '現金', type: 'expense', date: input,
            }, { pools: POOLS })
            expect(r.valid, `input=${input}`).toBe(false)
            expect(r.issues.join()).toContain('日期格式無效')
        }
    })

    it('動態 enum miss + 模糊匹配命中 → 自動修正並附 resolvedFrom', () => {
        const args = { amount: 100, category: '餐飲 ', account: 'line pay', type: 'expense', date: '2026-08-21' }
        const r = validateCall('add_record', args, { pools: POOLS })
        expect(r.valid).toBe(true)
        expect(args.category).toBe('餐飲') // normalization（去空白/小寫）後命中
        expect(args.account).toBe('LINE Pay')
        expect(r.resolvedFrom).toEqual({ category: '餐飲 ', account: 'line pay' })
    })

    it('動態 enum miss + 模糊匹配未命中 → needsConfirmation（非 invalid）', () => {
        const r = validateCall('add_debt', {
            contact: '完全陌生人名XYZ', amount: 100, direction: 'lend', date: '2026-08-21'
        }, { pools: POOLS })
        // 格式本身沒問題（valid=true），但需要使用者確認（needsConfirmation=true）
        expect(r.valid).toBe(true)
        expect(r.needsConfirmation).toBe(true)
        expect(r.issues.join()).toContain('contact=完全陌生人名XYZ')
    })

    it('未知 tool → invalid（幻覺防護）', () => {
        const r = validateCall('make_money', {}, { pools: POOLS })
        expect(r.valid).toBe(false)
        expect(r.issues.join()).toContain('未知 tool')
    })

    it('未預期欄位 → invalid（additional_properties: false）', () => {
        const r = validateCall('add_record', {
            amount: 100, category: '餐飲', account: '現金', type: 'expense', date: '2026-08-21', extra: 1
        }, { pools: POOLS })
        expect(r.valid).toBe(false)
        expect(r.issues.join()).toContain('未預期欄位: extra')
    })

    it('transfer：from == to → invalid', () => {
        const r = validateCall('transfer', {
            from_account: '現金', to_account: '現金', amount: 100, date: '2026-08-21'
        }, { pools: POOLS })
        expect(r.valid).toBe(false)
        expect(r.issues.join()).toContain('來源與目標帳戶相同')
    })

    it('add_recurring：schedule_value 超出 1-28 → invalid', () => {
        const base = {
            amount: 12000, category: '其他', account: '玉山帳戶',
            schedule: 'monthly', schedule_value: 31, type: 'expense', date: '2026-09-01'
        }
        const r = validateCall('add_recurring', base, { pools: POOLS })
        expect(r.valid).toBe(false)
        expect(r.issues.join()).toContain('schedule_value 必須 ≤ 28')

        base.schedule_value = 5
        expect(validateCall('add_recurring', base, { pools: POOLS }).valid).toBe(true)
    })

    it('query_stats：metric=by_category 時 value 必填（conditional 規則）', () => {
        const missing = validateCall('query_stats', { metric: 'by_category', period: 'this_month' }, { pools: POOLS })
        expect(missing.valid).toBe(false)
        expect(missing.issues.join()).toContain('value')

        const ok = validateCall(
            'query_stats', { metric: 'by_category', value: '餐飲', period: 'this_month' }, { pools: POOLS }
        )
        expect(ok.valid).toBe(true)
    })

    it('parseToolCalls 整合：動態 enum miss 的 call 標記 needsConfirmation 且不改 args', () => {
        const text = '<tool_call>{"name": "settle_debt", "args": {"contact": "不認識的人", "amount": 200, "date": "2026-08-21"}}</tool_call>'
        const { calls } = parseToolCalls(text, { pools: POOLS, tools: ADD_PAGE_TOOLS })
        expect(calls).toHaveLength(1)
        expect(calls[0].valid).toBe(true) // 格式合法
        expect(calls[0].needsConfirmation).toBe(true) // 但 contact 需使用者確認
        expect(calls[0].args.contact).toBe('不認識的人') // 原始值保留，UI 端讓使用者選
    })
})

describe('toolsSchema - 小工具', () => {
    it('stripThinkingTags 相容  與  兩種形式', () => {
        expect(stripThinkingTags('<think>abc</think>hello')).toBe('hello')
        expect(stripThinkingTags('<thinking>abc</thinking>hello')).toBe('hello')
        expect(stripThinkingTags('no tags')).toBe('no tags')
    })

    it('fuzzyMatch：exact / normalization / 子字串 / 編輯距離 1 / 距離過大回 null', () => {
        const pool = ['餐飲', '交通', 'LINE Pay', '玉山帳戶']
        expect(fuzzyMatch('餐飲', pool)).toBe('餐飲')
        expect(fuzzyMatch('line pay', pool)).toBe('LINE Pay') // 小寫 + 空白 normalization
        expect(fuzzyMatch('玉山戶', pool)).toBe('玉山帳戶') // 子字串
        expect(fuzzyMatch('餐飲 ', pool)).toBe('餐飲') // 尾隨空白
        expect(fuzzyMatch('玉山帳扈', pool)).toBe('玉山帳戶') // 編輯距離 1
        expect(fuzzyMatch('完全不相關的一串很長文字', pool)).toBeNull()
    })

    it('stripThinkingTags 保留 tag 外的正規內容', () => {
        expect(stripThinkingTags('  <thinking>思考</thinking>  輸出  ')).toBe('輸出')
    })
})

describe('toolsSchema - schema 一致性', () => {
    it('6 個 tool 皆定義且 phase/kind 欄位齊全', () => {
        const names = TOOLS_SCHEMA.tools.map(t => t.name)
        expect(names).toEqual([
            'add_record', 'transfer', 'add_debt', 'settle_debt', 'add_recurring', 'query_stats'
        ])
        for (const t of TOOLS_SCHEMA.tools) {
            expect(t.description).toBeTruthy()
            expect(['action', 'query']).toContain(t.kind)
            expect(t.parameters.required.length).toBeGreaterThan(0)
            for (const key of t.parameters.required) {
                expect(t.parameters.properties).toHaveProperty(key)
            }
        }
    })

    it('contexts 引用的 tool 皆存在', () => {
        for (const list of Object.values(TOOLS_SCHEMA.contexts)) {
            for (const name of list) {
                expect(TOOLS_SCHEMA.tools.map(t => t.name)).toContain(name)
            }
        }
    })
})
