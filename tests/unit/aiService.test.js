import { describe, it, expect } from 'vitest'
import { AIService, QUANTIZATION_MODELS, fuzzyMatchAccount, fuzzyMatchCategory, findLiteralCategoryName } from '../../src/js/aiService.js'

describe('AIService - generateSystemPrompt', () => {
    it('動態分類與帳戶能正確注入 Prompt 內部的 enum 欄位與日期錨定', () => {
        const dataServiceMock = {}
        const aiService = new AIService(dataServiceMock)
        const categories = ['餐飲', '交通', '貓咪用品']
        const accounts = ['現金', '貓貓儲值卡']
        const testDate = new Date('2026-08-03T10:00:00')

        const prompt = aiService.generateSystemPrompt(categories, accounts, testDate)

        expect(prompt).toContain('今天是 2026-08-03（星期一）')
        expect(prompt).toContain('你是一個記帳助理。')
        expect(prompt).toContain('你被賦予了以下 tools:')
        expect(prompt).toContain('餐飲')
        expect(prompt).toContain('交通')
        expect(prompt).toContain('貓咪用品')
        expect(prompt).toContain('現金')
        expect(prompt).toContain('貓貓儲值卡')
        
        const parsedJson = JSON.parse(prompt.split('被賦予了以下 tools:\n')[1].trim())
        expect(parsedJson.parameters.properties.category.enum).toEqual(categories)
        expect(parsedJson.parameters.properties.account.enum).toEqual(accounts)
        expect(parsedJson.parameters.properties.date).toBeDefined()
    })
})

describe('AIService - extractToolCall', () => {
    const dataServiceMock = {}
    const aiService = new AIService(dataServiceMock)

    it('能成功解析標準 <tool_call> XML 標籤包裹的 JSON', () => {
        const output = '<tool_call>{"name": "add_record", "args": {"amount": 150, "category": "餐飲", "account": "信用卡", "description": "麥當勞午餐", "type": "expense", "date": "2026-08-03"}}</tool_call>'
        const record = aiService.extractToolCall(output)
        
        expect(record).toEqual({
            amount: 150,
            category: '餐飲',
            account: '信用卡',
            description: '麥當勞午餐',
            type: 'expense',
            date: '2026-08-03'
        })
    })

    it('能成功解析「特殊 Token 壓縮格式」 ([AMT], [CAT], [ACC], [DESC], [DATE], [TYPE])', () => {
        const output = '<tool_call>[AMT]350[CAT]娛樂[ACC]銀行帳戶[DESC]電影票[DATE]2026-08-02[TYPE]expense</tool_call>'
        const record = aiService.extractToolCall(output)

        expect(record).toEqual({
            amount: 350,
            category: '娛樂',
            account: '銀行帳戶',
            description: '電影票',
            type: 'expense',
            date: '2026-08-02'
        })
    })

    it('能自動抹除 <think> 思考鏈標籤再解析內部格式', () => {
        const output = '<think>使用者花了 120 元吃早餐，分類應選餐飲...</think><tool_call>[AMT]120[CAT]餐飲[ACC]現金[DESC]早餐[TYPE]expense</tool_call>'
        const record = aiService.extractToolCall(output)

        expect(record.amount).toBe(120)
        expect(record.category).toBe('餐飲')
        expect(record.description).toBe('早餐')
    })

    it('當金額非有效數字時，應拋出錯誤', () => {
        const output = '<tool_call>{"amount": "abc", "category": "餐飲", "account": "現金", "type": "expense"}</tool_call>'
        expect(() => aiService.extractToolCall(output)).toThrow('AI 未能提取有效的記帳金額')
    })

    it('當金額小於等於 0 時，應拋出錯誤', () => {
        const output = '<tool_call>{"amount": -50, "category": "餐飲", "account": "現金", "type": "expense"}</tool_call>'
        expect(() => aiService.extractToolCall(output)).toThrow('AI 未能提取有效的記帳金額')
    })

    it('當無任何合規格式時，應拋出錯誤', () => {
        const output = '這是一句普通的話，不包含任何記帳格式。'
        expect(() => aiService.extractToolCall(output)).toThrow('無法從 AI 輸出中提取 Tool Call 格式')
    })
})

describe('AIService - parseRecord與日期計算', () => {
    it('在規則回退模式下能解析「昨天」並推算出正確的日期字串', async () => {
        const dataServiceMock = {}
        const aiService = new AIService(dataServiceMock)
        const categories = ['餐飲', '交通']
        const accounts = ['現金', '信用卡']
        const baseDate = new Date('2026-08-03T12:00:00')

        const result = await aiService.parseRecord('昨天吃拉麵花了250元刷信用卡', categories, accounts, baseDate)

        expect(result.amount).toBe(250)
        expect(result.category).toBe('餐飲')
        expect(result.account).toBe('信用卡')
        expect(result.type).toBe('expense')
        expect(result.date).toBe('2026-08-02') // 2026-08-03 扣除一天為 2026-08-02
    })

    it('當引擎未就緒時，parseRecord 回退規則引擎並標記 lastMode=rules', async () => {
        const dataServiceMock = {}
        const aiService = new AIService(dataServiceMock)
        const categories = ['餐飲', '交通']
        const accounts = ['現金', '信用卡']

        const result = await aiService.parseRecord('今天吃火鍋花了600元', categories, accounts, new Date('2026-08-03T12:00:00'))

        expect(aiService.lastMode).toBe('rules')
        expect(result.amount).toBe(600)
        expect(result.type).toBe('expense')
    })
})

describe('AIService - 量化模型管理', () => {
    it('提供正常的量化模型選項列表與正確的 HuggingFace 直連網址', () => {
        expect(QUANTIZATION_MODELS.q4_0.sizeMB).toBe(34.1)
        expect(QUANTIZATION_MODELS.q5_0.sizeMB).toBe(41.6)
        expect(QUANTIZATION_MODELS.q6_k.sizeMB).toBe(240.3)
        expect(QUANTIZATION_MODELS.q8_0.sizeMB).toBe(64.1)
        expect(QUANTIZATION_MODELS.fp16.sizeMB).toBe(120.3)
        expect(QUANTIZATION_MODELS.q4_0.url).toBe('https://huggingface.co/the-walking-fish/jijun-LM-GGUF/resolve/main/bookkeeping_model_q4_0.gguf')
    })

    it('在離線狀態下 checkForModelUpdate 回傳 hasUpdate: false 且不拋錯', async () => {
        const aiService = new AIService({})
        localStorage.setItem('ai_model_downloaded_q4_0', 'true')
        
        const originalOnLine = navigator.onLine
        Object.defineProperty(navigator, 'onLine', { value: false, configurable: true })

        const res = await aiService.checkForModelUpdate('q4_0')
        expect(res.hasUpdate).toBe(false)

        Object.defineProperty(navigator, 'onLine', { value: originalOnLine, configurable: true })
    })

    it('hasModelUpdate 能正確反映 localStorage 的更新狀態標記', () => {
        const aiService = new AIService({})
        localStorage.removeItem('ai_model_update_available_q4_0')
        expect(aiService.hasModelUpdate('q4_0')).toBe(false)

        localStorage.setItem('ai_model_update_available_q4_0', 'true')
        expect(aiService.hasModelUpdate('q4_0')).toBe(true)
    })
})

describe('AIService - 防呆機制 System Prompt 重構', () => {
    it('當僅傳入特定收支類型的分類時，System Prompt 的 enum 僅包含該收支類型的分類', () => {
        const dataServiceMock = {}
        const aiService = new AIService(dataServiceMock)
        const expenseCategories = ['餐飲', '交通', '房貸', '娛樂']
        const accounts = ['現金', '信用卡']

        const prompt = aiService.generateSystemPrompt(expenseCategories, accounts, new Date('2026-08-03'))
        const parsedJson = JSON.parse(prompt.split('被賦予了以下 tools:\n')[1].trim())

        expect(parsedJson.parameters.properties.category.enum).toEqual(expenseCategories)
        expect(parsedJson.parameters.properties.category.enum).not.toContain('薪水')
    })
})

describe('AIService - 思考鏈標籤剥离 (Bug 1 回归)', () => {
    const dataServiceMock = {}
    const aiService = new AIService(dataServiceMock)

    it('能剥离 <thinking> 尖括号形式 (DeepSeek-R1/Qwen3 真实输出)', () => {
        const output = '<thinking>用户花了120元，判断为餐饮</thinking><tool_call>{"name":"add_record","args":{"amount":120,"category":"餐飲","account":"現金","description":"午餐","type":"expense"}}</tool_call>'
        const record = aiService.extractToolCall(output)
        expect(record.amount).toBe(120)
        expect(record.category).toBe('餐飲')
        expect(record.type).toBe('expense')
    })

    it('能剥离无尖括号的 thinking... 非标准形式 (兼容旧测试用例)', () => {
        const output = ' thinking用户花了120元吃早餐<tool_call>{"name":"add_record","args":{"amount":120,"category":"餐飲","account":"現金","description":"早餐","type":"expense"}}</tool_call>'
        const record = aiService.extractToolCall(output)
        expect(record.amount).toBe(120)
        expect(record.description).toBe('早餐')
    })

    it('思考鏈內容含特殊標記時不會誤匹配 [AMT]/[CAT]', () => {
        // 思考鏈里出现的 [AMT] 不应干扰最终 tool call 解析
        const output = '<thinking>[AMT]999[CAT]測試</thinking><tool_call>{"amount":30,"category":"交通","account":"現金","description":"公車","type":"expense"}</tool_call>'
        const record = aiService.extractToolCall(output)
        expect(record.amount).toBe(30)
        expect(record.category).toBe('交通')
    })
})

describe('AIService - 繁體/簡體关键词兼容 (簡体输入支持)', () => {
    it('繁体「領了薪水」被正确识别为收入', async () => {
        const aiService = new AIService({})
        const categories = ['餐飲', '交通', '薪水']
        const accounts = ['現金', '銀行']
        const result = await aiService.parseRecord('領了薪水 5000 元存入銀行', categories, accounts, new Date('2026-08-03T12:00:00'))
        expect(result.type).toBe('income')
        expect(result.amount).toBe(5000)
    })

    it('繁體「賺到 300 元」被正确识别为收入', async () => {
        const aiService = new AIService({})
        const categories = ['餐饮', '其他']
        const accounts = ['現金']
        const result = await aiService.parseRecord('賺到 300 元', categories, accounts, new Date('2026-08-03T12:00:00'))
        expect(result.type).toBe('income')
    })

    it('简体「领到工资」「赚了」输入也能被识别为收入 (简体兼容增强)', async () => {
        const aiService = new AIService({})
        const categories = ['餐饮', '其他']
        const accounts = ['現金']
        const result1 = await aiService.parseRecord('今天领到工资 500 元', categories, accounts, new Date('2026-08-03T12:00:00'))
        expect(result1.type).toBe('income')
        const result2 = await aiService.parseRecord('赚了 200 元', categories, accounts, new Date('2026-08-03T12:00:00'))
        expect(result2.type).toBe('income')
    })

    it('普通支出不受关键词扩充影响', async () => {
        const aiService = new AIService({})
        const result = await aiService.parseRecord('買貓糧花了 200 元', ['宠物', '其他'], ['現金'], new Date('2026-08-03T12:00:00'))
        expect(result.type).toBe('expense')
    })
})

describe('AIService - 「花了100元」支出語意守門與糾錯機制', () => {
    const aiService = new AIService({})

    it('「花了100元」口語輸入精確解析為支出 (expense)', async () => {
        const result = await aiService.parseRecord('花了100元', ['飲食', '其他'], ['現金'], new Date('2026-08-03T12:00:00'))
        expect(result.amount).toBe(100)
        expect(result.type).toBe('expense')
    })

    it('「花100元買飲料」解析為支出 (expense)', async () => {
        const result = await aiService.parseRecord('花100元買飲料', ['飲食', '其他'], ['現金'], new Date('2026-08-03T12:00:00'))
        expect(result.amount).toBe(100)
        expect(result.type).toBe('expense')
    })

    it('「買了早餐花費80元」解析為支出 (expense)', async () => {
        const result = await aiService.parseRecord('買了早餐花費80元', ['飲食', '其他'], ['現金'], new Date('2026-08-03T12:00:00'))
        expect(result.amount).toBe(80)
        expect(result.type).toBe('expense')
    })

    it('當模型因幻覺輸出 income 時，前端語意守門能將「花了100元」自動校正為 expense', () => {
        const hallucinatedOutput = '<tool_call>{"name":"add_record","args":{"amount":100,"category":"其他","account":"現金","description":"100元","type":"income"}}</tool_call>'
        const record = aiService.extractToolCall(hallucinatedOutput, '花了100元')
        expect(record.type).toBe('expense')
        expect(record.amount).toBe(100)
    })

    it('當模型因幻覺輸出 expense 時，前端語意守門能將「領了獎金5000元」自動校正為 income', () => {
        const hallucinatedOutput = '<tool_call>{"name":"add_record","args":{"amount":5000,"category":"獎金","account":"現金","description":"獎金","type":"expense"}}</tool_call>'
        const record = aiService.extractToolCall(hallucinatedOutput, '領了獎金5000元')
        expect(record.type).toBe('income')
        expect(record.amount).toBe(5000)
    })

    it('System Prompt 與訓練集 Protocol 規範一致 (簡潔 properties 且包含所需 tools 定義)', () => {
        const prompt = aiService.generateSystemPrompt(['飲食', '其他'], ['現金'], new Date('2026-08-03'))
        expect(prompt).toContain('你是一個記帳助理。你被賦予了以下 tools:\n')
        const toolDef = JSON.parse(prompt.split('被賦予了以下 tools:\n')[1].trim())
        expect(toolDef.name).toBe('add_record')
        expect(toolDef.parameters.properties.amount.type).toBe('number')
        expect(toolDef.parameters.properties.type.enum).toEqual(['expense', 'income'])
        expect(toolDef.parameters.required).toEqual(['amount', 'category', 'account', 'type', 'date'])
    })
})

describe('AIService - 類別名字面命中守門（孝親費10000 型）', () => {
    const aiService = new AIService({})
    // 使用者自訂類別名（從未進過訓練 enum 池，模型認不出詞）
    const CATS = ['飲食', '日常', '交通', '娛樂', '醫療', '教育', '還款', '其他', '孝親費', '代墊', '股票', '電話費']

    it('findLiteralCategoryName 命中字面類別名並取最長', () => {
        expect(findLiteralCategoryName('孝親費10000', CATS)).toBe('孝親費')
        expect(findLiteralCategoryName('孝親費10000給媽', CATS)).toBe('孝親費')
        expect(findLiteralCategoryName('昨天打電話費1200', CATS)).toBe('電話費')
        // 最長優先
        expect(findLiteralCategoryName('股票股利500', ['股票', '股票股利'])).toBe('股票股利')
        // 單字類別不參與（避免誤傷）
        expect(findLiteralCategoryName('買衣50', ['衣'])).toBeNull()
        // 完全沒命中
        expect(findLiteralCategoryName('買晚餐600', CATS)).toBeNull()
        expect(findLiteralCategoryName('', CATS)).toBeNull()
        expect(findLiteralCategoryName('孝親費100', [])).toBeNull()
        // 接受 {name} 物件陣列
        expect(findLiteralCategoryName('代墊300', [{ id: 1, name: '代墊' }])).toBe('代墊')
        // 「其他」是連接詞高頻字（買東西和其他雜支）且不參與字面命中
        expect(findLiteralCategoryName('買東西和其他雜支300', ['其他', '飲食'])).toBeNull()
    })

    it('模型選錯類別時，字面守門覆寫為原文的分類（孝親費10000 實測案例）', () => {
        // v4c f16 GGUF 實測輸出：category 誤判為教育、description 幻覺成「孫親費」
        const TC = '<' + '|tool_call|>'
        const hallucinated = TC + '{"name":"add_record","args":{"amount":10000,"category":"教育","account":"現金","description":"孫親費","type":"expense","date":"2026-10-14"}}'
        const record = aiService.extractToolCall(hallucinated, '孝親費10000', CATS)
        expect(record.category).toBe('孝親費')
        expect(record.amount).toBe(10000)
        // 幻覺 description「孫親費」應被原文殘句取代（此例殘句為空 → 回填類別名）
        expect(record.description).toBe('孝親費')
    })

    it('「孝親費10000給媽」保留給媽資訊到 description', () => {
        const TC = '<' + '|tool_call|>'
        const hallucinated = TC + '{"name":"add_record","args":{"amount":10000,"category":"教育","account":"現金","description":"孫親費","type":"expense","date":"2026-10-14"}}'
        const record = aiService.extractToolCall(hallucinated, '孝親費10000給媽', CATS)
        expect(record.category).toBe('孝親費')
        expect(record.description).toContain('給媽')
    })

    it('模型已選對類別時不重複打擾；description 有原文根據時不改寫', () => {
        const TC = '<' + '|tool_call|>'
        const good = TC + '{"name":"add_record","args":{"amount":600,"category":"飲食","account":"現金","description":"晚餐","type":"expense","date":"2026-10-14"}}'
        const record = aiService.extractToolCall(good, '買晚餐600', CATS)
        expect(record.category).toBe('飲食')
        expect(record.description).toBe('晚餐')
    })

    it('未命中任何字面類別名時完全不介入（回歸保護）', () => {
        const TC = '<' + '|tool_call|>'
        const out = TC + '{"name":"add_record","args":{"amount":300,"category":"日常","account":"現金","description":"雜貨","type":"expense","date":"2026-10-14"}}'
        const record = aiService.extractToolCall(out, '買了一些雜貨300元', CATS)
        expect(record.category).toBe('日常')
        expect(record.description).toBe('雜貨')
    })

    it('不傳 categories 時向後相容（舊呼叫端不受影響）', () => {
        const TC = '<' + '|tool_call|>'
        const out = TC + '{"name":"add_record","args":{"amount":300,"category":"日常","account":"現金","description":"雜貨","type":"expense","date":"2026-10-14"}}'
        const record = aiService.extractToolCall(out, '孝親費300')
        expect(record.category).toBe('日常')
    })
})

describe('AIService - 巢狀 JSON 與 Stop Token 截斷容錯 (v2~v4c 格式修復)', () => {
    const aiService = new AIService({})

    it('當模型輸出觸發 stop 未產生 </tool_call> 閉合標籤時，仍能正確提取巢狀 JSON', () => {
        // stop token 是 </tool_call>，所以 responseText 常常不帶 </tool_call>
        const truncatedOutput = '<tool_call>{"name": "add_record", "args": {"amount": 60, "category": "飲食", "account": "現金", "description": "早餐", "type": "expense", "date": "2026-04-10"}}'
        const record = aiService.extractToolCall(truncatedOutput)
        expect(record.amount).toBe(60)
        expect(record.category).toBe('飲食')
        expect(record.account).toBe('現金')
        expect(record.description).toBe('早餐')
        expect(record.type).toBe('expense')
        expect(record.date).toBe('2026-04-10')
    })

    it('平衡括號解析器能正確跳過字串內部的括號', () => {
        const complexOutput = '<tool_call>{"name": "add_record", "args": {"amount": 180, "category": "飲食", "account": "現金", "description": "漢堡包{特製醬}與可樂", "type": "expense", "date": "2026-04-10"}}</tool_call>'
        const record = aiService.extractToolCall(complexOutput)
        expect(record.amount).toBe(180)
        expect(record.description).toBe('漢堡包{特製醬}與可樂')
    })

    it('當 JSON 結尾微截斷 (缺外層大括號) 時能自動補齊解析', () => {
        const slightlyTruncated = '<tool_call>{"name": "add_record", "args": {"amount": 250, "category": "交通", "account": "悠遊卡", "description": "高鐵票", "type": "expense", "date": "2026-04-10"}'
        const record = aiService.extractToolCall(slightlyTruncated)
        expect(record.amount).toBe(250)
        expect(record.category).toBe('交通')
        expect(record.account).toBe('悠遊卡')
    })

    it('能正確解析 arguments 為 JSON 字串的情形', () => {
        const stringifiedArgs = '<tool_call>{"name": "add_record", "arguments": "{\\"amount\\": 300, \\"category\\": \\"日常\\", \\"account\\": \\"現金\\", \\"description\\": \\"衛生紙\\", \\"type\\": \\"expense\\"}"}</tool_call>'
        const record = aiService.extractToolCall(stringifiedArgs)
        expect(record.amount).toBe(300)
        expect(record.category).toBe('日常')
    })
})

describe('AIService - 模型 Hash 比對與更新機制', () => {
    it('checkForModelUpdate 支援 options.force 跳過冷卻時間並能依據 ETag 偵測更新', async () => {
        const aiService = new AIService({})
        localStorage.setItem('ai_model_downloaded_q4_0', 'true')
        localStorage.setItem('ai_model_etag_q4_0', 'old_hash_12345')
        localStorage.setItem('ai_model_update_available_q4_0', 'false')

        // 模擬剛檢查過（在 12 小時冷卻內）
        localStorage.setItem('ai_model_last_check_time_q4_0', Date.now().toString())

        // 模擬遠端 HEAD 回傳新的 ETag
        aiService.fetchRemoteModelHash = async () => 'new_hash_67890'

        // 不帶 force：應受限於冷卻時間
        const coolDownRes = await aiService.checkForModelUpdate('q4_0')
        expect(coolDownRes.hasUpdate).toBe(false)

        // 帶 force：跳過冷卻，比對出新 Hash
        const forceRes = await aiService.checkForModelUpdate('q4_0', { force: true })
        expect(forceRes.hasUpdate).toBe(true)
        expect(forceRes.etag).toBe('new_hash_67890')
        expect(aiService.hasModelUpdate('q4_0')).toBe(true)
    })

    it('當遠端 Hash 與本地相同時，判定為無更新', async () => {
        const aiService = new AIService({})
        localStorage.setItem('ai_model_downloaded_q4_0', 'true')
        localStorage.setItem('ai_model_etag_q4_0', 'same_hash_12345')

        aiService.fetchRemoteModelHash = async () => 'same_hash_12345'

        const res = await aiService.checkForModelUpdate('q4_0', { force: true })
        expect(res.hasUpdate).toBe(false)
        expect(aiService.hasModelUpdate('q4_0')).toBe(false)
    })
})

describe('AIService - 帳戶與分類模糊匹配 (fuzzyMatchAccount / fuzzyMatchCategory)', () => {
    const mockAccounts = [
        { id: 1, name: '現金', type: 'cash' },
        { id: 2, name: '國泰世華銀行', type: 'bank' },
        { id: 3, name: '台新 Richart', type: 'bank' },
        { id: 4, name: '中國信託 LINE Pay 信用卡', type: 'credit_card' },
        { id: 5, name: 'Apple Pay', type: 'other' },
        { id: 6, name: '街口支付', type: 'other' }
    ]

    const mockCategories = [
        { id: 'c1', name: '飲食' },
        { id: 'c2', name: '交通' },
        { id: 'c3', name: '日常' },
        { id: 'c4', name: '娛樂' },
        { id: 'c5', name: '醫療' },
        { id: 'c6', name: '薪水' }
    ]

    describe('fuzzyMatchAccount', () => {
        it('完全精確匹配', () => {
            const acc = fuzzyMatchAccount('現金', mockAccounts)
            expect(acc?.id).toBe(1)
        })

        it('忽略大小寫、空白與符號 (LINE Pay vs linepay)', () => {
            const acc1 = fuzzyMatchAccount('line pay', mockAccounts)
            expect(acc1?.id).toBe(4) // 包含 LINE Pay
            const acc2 = fuzzyMatchAccount('applepay', mockAccounts)
            expect(acc2?.id).toBe(5)
        })

        it('雙向子字串包含匹配 (國泰 -> 國泰世華銀行, Richart -> 台新 Richart, 街口 -> 街口支付)', () => {
            const acc1 = fuzzyMatchAccount('國泰', mockAccounts)
            expect(acc1?.id).toBe(2)
            const acc2 = fuzzyMatchAccount('Richart', mockAccounts)
            expect(acc2?.id).toBe(3)
            const acc3 = fuzzyMatchAccount('街口', mockAccounts)
            expect(acc3?.id).toBe(6)
        })

        it('信用卡口語關鍵字（刷卡/信用卡）精確匹配 credit_card 帳戶', () => {
            const acc = fuzzyMatchAccount('信用卡', mockAccounts)
            expect(acc?.id).toBe(4)
            const acc2 = fuzzyMatchAccount('刷卡', mockAccounts)
            expect(acc2?.id).toBe(4)
        })

        it('銀行/轉帳關鍵字精確匹配 bank 帳戶', () => {
            const acc = fuzzyMatchAccount('轉帳', mockAccounts)
            expect(acc?.type).toBe('bank')
        })

        it('空值或無匹配時安全回傳 null', () => {
            expect(fuzzyMatchAccount('', mockAccounts)).toBeNull()
            expect(fuzzyMatchAccount('不存在的虛擬幣', mockAccounts)).toBeNull()
        })
    })

    describe('fuzzyMatchCategory', () => {
        it('完全精確匹配', () => {
            const cat = fuzzyMatchCategory('飲食', mockCategories)
            expect(cat?.id).toBe('c1')
        })

        it('生活領域同義詞智能映射 (便當/火鍋/咖啡 -> 飲食, 捷運/公車/加油 -> 交通)', () => {
            const cat1 = fuzzyMatchCategory('便當', mockCategories)
            expect(cat1?.name).toBe('飲食')
            const cat2 = fuzzyMatchCategory('火鍋', mockCategories)
            expect(cat2?.name).toBe('飲食')
            const cat3 = fuzzyMatchCategory('手搖飲料', mockCategories)
            expect(cat3?.name).toBe('飲食')
            const cat4 = fuzzyMatchCategory('捷運', mockCategories)
            expect(cat4?.name).toBe('交通')
            const cat5 = fuzzyMatchCategory('加油', mockCategories)
            expect(cat5?.name).toBe('交通')
            const cat6 = fuzzyMatchCategory('生活用品', mockCategories)
            expect(cat6?.name).toBe('日常')
        })

        it('空值或無匹配時安全回傳 null', () => {
            expect(fuzzyMatchCategory('', mockCategories)).toBeNull()
            expect(fuzzyMatchCategory('天馬行空無關詞', mockCategories)).toBeNull()
        })
    })

    describe('applyLiteralCategoryGuardrail & _ruleInference', () => {
        it('支出類型不被收入分類 (如零用錢) 誤覆寫', () => {
            const aiService = new AIService({})
            const categories = [
                { id: 'food', name: '飲食', type: 'expense' },
                { id: 'pocket', name: '零用錢', type: 'income' }
            ]
            const record = {
                amount: 50,
                category: '飲食',
                account: '現金',
                description: '早餐',
                type: 'expense'
            }
            const res = aiService.applyLiteralCategoryGuardrail(record, '用零用錢買早餐50元', categories)
            expect(res.category).toBe('飲食')
        })

        it('_ruleInference 能正確解析物件陣列形式的 categories 與 accounts', () => {
            const aiService = new AIService({})
            const categories = [{ id: 'food', name: '飲食' }, { id: 'traffic', name: '交通' }]
            const accounts = [{ id: 1, name: '現金' }, { id: 2, name: '信用卡' }]
            const output = aiService._ruleInference('今天吃火鍋600元用信用卡', categories, accounts)
            expect(output).toContain('[CAT]飲食')
            expect(output).toContain('[ACC]信用卡')
            expect(output).not.toContain('[object Object]')
        })
    })
})


