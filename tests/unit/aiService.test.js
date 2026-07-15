import { describe, it, expect } from 'vitest'
import { AIService } from '../../src/js/aiService.js'

describe('AIService - generateSystemPrompt', () => {
    it('動態分類與帳戶能正確注入 Prompt 內部的 enum 欄位', () => {
        const dataServiceMock = {}
        const aiService = new AIService(dataServiceMock)
        const categories = ['餐飲', '交通', '貓咪用品']
        const accounts = ['現金', '貓貓儲值卡']

        const prompt = aiService.generateSystemPrompt(categories, accounts)

        // 驗證生成的 prompt 包含對應的 categories 與 accounts
        expect(prompt).toContain('你是一個實用的記帳助手')
        expect(prompt).toContain('餐飲')
        expect(prompt).toContain('交通')
        expect(prompt).toContain('貓咪用品')
        expect(prompt).toContain('現金')
        expect(prompt).toContain('貓貓儲值卡')
        
        // 驗證結構正確
        const parsedJson = JSON.parse(prompt.split('被賦予的 tools 如下:')[1].trim())
        expect(parsedJson.parameters.properties.category.enum).toEqual(categories)
        expect(parsedJson.parameters.properties.account.enum).toEqual(accounts)
    })
})

describe('AIService - extractToolCall', () => {
    const dataServiceMock = {}
    const aiService = new AIService(dataServiceMock)

    it('能成功解析標準 <tool_call> XML 標籤包裹的 JSON', () => {
        const output = '<tool_call>{"name": "add_record", "args": {"amount": 150, "category": "餐飲", "account": "信用卡", "description": "麥當勞午餐", "type": "expense"}}</tool_call>'
        const record = aiService.extractToolCall(output)
        
        expect(record).toEqual({
            amount: 150,
            category: '餐飲',
            account: '信用卡',
            description: '麥當勞午餐',
            type: 'expense'
        })
    })

    it('即使無 args 直接解析物件亦可相容', () => {
        const output = '<tool_call>{"amount": 200, "category": "交通", "account": "悠遊卡", "description": "搭捷運", "type": "expense"}</tool_call>'
        const record = aiService.extractToolCall(output)
        
        expect(record).toEqual({
            amount: 200,
            category: '交通',
            account: '悠遊卡',
            description: '搭捷運',
            type: 'expense'
        })
    })

    it('當缺少 <tool_call> 標籤但包含合規的 JSON 物件時，能透過 Fallback 順利解析', () => {
        const output = '好的，我幫您記帳：\n{"amount": 50000, "category": "薪水", "account": "銀行帳戶", "description": "發工資啦", "type": "income"}'
        const record = aiService.extractToolCall(output)
        
        expect(record).toEqual({
            amount: 50000,
            category: '薪水',
            account: '銀行帳戶',
            description: '發工資啦',
            type: 'income'
        })
    })

    it('當金額非有效數字時，應拋出錯誤', () => {
        const output = '<tool_call>{"amount": "abc", "category": "餐飲", "account": "現金", "type": "expense"}</tool_call>'
        expect(() => aiService.extractToolCall(output)).toThrow('AI 未能提取有效的記帳金額')
    })

    it('當金額小於等於 0 時，應拋出錯誤', () => {
        const output = '<tool_call>{"amount": -50, "category": "餐飲", "account": "現金", "type": "expense"}</tool_call>'
        expect(() => aiService.extractToolCall(output)).toThrow('AI 未能提取有效的記帳金額')
    })

    it('當無任何 JSON 格式時，應拋出錯誤', () => {
        const output = '這是一句普通的話，不包含任何記帳格式。'
        expect(() => aiService.extractToolCall(output)).toThrow('無法從 AI 輸出中提取 Tool Call JSON 格式')
    })
})

describe('AIService - parseRecord (Mock 推論模式)', () => {
    it('在 mock 模式下能正常解析字串，並提取出金額與分類', async () => {
        const dataServiceMock = {}
        const aiService = new AIService(dataServiceMock)
        const categories = ['餐飲', '交通', '娛樂']
        const accounts = ['現金', '信用卡']

        const result = await aiService.parseRecord('中午吃麥當勞花了150元，刷信用卡', categories, accounts)

        expect(result.amount).toBe(150)
        expect(result.category).toBe('餐飲')
        expect(result.account).toBe('信用卡')
        expect(result.type).toBe('expense')
        expect(result.description).toContain('麥當勞')
    })
})
