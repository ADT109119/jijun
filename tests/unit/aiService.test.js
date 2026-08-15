import { describe, it, expect } from 'vitest'
import { AIService, QUANTIZATION_MODELS } from '../../src/js/aiService.js'

describe('AIService - generateSystemPrompt', () => {
    it('動態分類與帳戶能正確注入 Prompt 內部的 enum 欄位與日期錨定', () => {
        const dataServiceMock = {}
        const aiService = new AIService(dataServiceMock)
        const categories = ['餐飲', '交通', '貓咪用品']
        const accounts = ['現金', '貓貓儲值卡']
        const testDate = new Date('2026-08-03T10:00:00')

        const prompt = aiService.generateSystemPrompt(categories, accounts, testDate)

        expect(prompt).toContain('今天是 2026-08-03（星期一）')
        expect(prompt).toContain('你是一個記帳助理。你被賦予了以下 tools:')
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
