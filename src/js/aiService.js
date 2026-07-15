/**
 * AIService - PWA 離線 AI 記帳服務
 * 負責下載模型、初始化 wllama 推論引擎、動態組裝 Prompt 以及穩健解析 Tool Call
 */

export class AIService {
    /**
     * @param {import('./dataService.js').default} dataService
     */
    constructor(dataService) {
        /** @type {import('./dataService.js').default} */
        this.dataService = dataService;

        /** @type {any|null} wllama 實例 */
        this.wllama = null;

        /** @type {boolean} 模型是否加載完成 */
        this.isLoaded = false;
    }

    /**
     * 初始化模型 (下載並載入 GGUF 模型)
     * @param {function} [onProgress] - 下載與載入進度回呼函數 (0 to 100)
     * @returns {Promise<boolean>} - 初始化是否成功
     */
    async initModel(onProgress) {
        if (this.isLoaded) return true;

        try {
            // wllama 動態加載：在瀏覽器端，我們需要引進 wllama 的 WASM 載入器
            // 這裡為 wllama 的初始化接口預留空間
            // 實際使用時需要引入：import { Wllama } from '@wllama/wllama'; (或 cdn 版本)
            if (typeof window !== 'undefined') {
                if (onProgress) onProgress(10);
                
                // Mock 載入流程，供前端開發與 Spike 測試前使用
                await new Promise((resolve) => setTimeout(resolve, 500));
                if (onProgress) onProgress(100);
                
                this.isLoaded = true;
                return true;
            }
            return false;
        } catch (error) {
            console.error('AI 模型初始化失敗:', error);
            throw new Error('無法啟動本地 AI 引擎: ' + error.message);
        }
    }

    /**
     * 生成包含動態分類與帳戶的 System Prompt
     * @param {string[]} categories - 分類清單
     * @param {string[]} accounts - 帳戶清單
     * @returns {string} - 組裝好的 System Prompt
     */
    generateSystemPrompt(categories, accounts) {
        const cleanCategories = Array.isArray(categories) && categories.length > 0 ? categories : ['餐飲', '交通', '娛樂', '生活'];
        const cleanAccounts = Array.isArray(accounts) && accounts.length > 0 ? accounts : ['現金', '信用卡', '銀行帳戶'];

        const tool = {
            name: "add_record",
            description: "新增一筆記帳記錄（支出或收入）",
            parameters: {
                type: "object",
                properties: {
                    amount: { 
                        type: "number", 
                        description: "記帳的數值金額，必須大於零。" 
                    },
                    category: { 
                        type: "string", 
                        enum: cleanCategories,
                        description: "記帳的分類，必須從給定的清單中選擇一個最合適的。" 
                    },
                    account: { 
                        type: "string", 
                        enum: cleanAccounts,
                        description: "交易的帳戶或支付媒介，必須從給定的清單中選擇一個。" 
                    },
                    description: { 
                        type: "string", 
                        description: "消費說明或備註（例如: 麥當勞、大美式、搭計程車）。" 
                    },
                    type: { 
                        type: "string", 
                        enum: ["expense", "income"], 
                        description: "記帳類型：expense 代表支出，income 代表收入。" 
                    }
                },
                required: ["amount", "category", "account", "type"]
            }
        };

        return `你是一個實用的記帳助手。請根據使用者的輸入，調用 add_record 工具。你只能調用這一個工具。
你必須輸出符合 XML 標籤格式的 tool call，例如：
<tool_call>{"name": "add_record", "args": {"amount": 100, "category": "餐飲", "account": "現金", "description": "午餐", "type": "expense"}}</tool_call>

被賦予的 tools 如下:
${JSON.stringify(tool, null, 2)}`;
    }

    /**
     * 解析使用者口語記帳文字
     * @param {string} text - 使用者的口語輸入 (例如: "剛剛吃午餐刷信用卡花了一百五")
     * @param {string[]} categories - 當前帳本的分類清單
     * @param {string[]} accounts - 當前帳本的帳戶清單
     * @returns {Promise<object>} - 解析後的結構化記帳物件
     */
    async parseRecord(text, categories, accounts) {
        if (!text || !text.trim()) {
            throw new Error('請輸入記帳內容');
        }

        // 確保模型已初始化
        await this.initModel();

        const systemPrompt = this.generateSystemPrompt(categories, accounts);

        let responseText = '';
        if (this.wllama) {
            // 如果 wllama 已載入，執行真正的推論
            const messages = [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: text }
            ];
            // wllama 格式與推論
            responseText = await this.wllama.createChatCompletion(messages, {
                temperature: 0.1, // 低溫度確保結構化輸出穩定
                max_tokens: 256
            });
        } else {
            // Mock 推論輸出，用於測試與 fallback
            responseText = this._mockInference(text, categories, accounts);
        }

        return this.extractToolCall(responseText);
    }

    /**
     * 容錯解析模型輸出的 Tool Call JSON
     * @param {string} responseText - 模型產生的文字
     * @returns {object}
     */
    extractToolCall(responseText) {
        if (!responseText) {
            throw new Error('模型輸出為空');
        }

        // 0. 剔除思考鏈標籤以相容 Reasoning/Thinking 模型 (如 DeepSeek-R1 / Qwen3 推理系列)
        responseText = responseText.replace(/<think>[\s\S]*?<\/think>/g, '');

        let jsonStr = '';

        // 1. 優先使用 Regex 匹配 <tool_call>...</tool_call>
        const toolCallMatch = responseText.match(/<tool_call>([\s\S]*?)<\/tool_call>/);
        if (toolCallMatch && toolCallMatch[1]) {
            jsonStr = toolCallMatch[1].trim();
        } else {
            // 2. Fallback: 尋找第一個大括號包裹的區塊
            const braceMatch = responseText.match(/\{[\s\S]*?\}/);
            if (braceMatch) {
                jsonStr = braceMatch[0].trim();
            }
        }

        if (!jsonStr) {
            throw new Error('無法從 AI 輸出中提取 Tool Call JSON 格式。原始輸出: ' + responseText);
        }

        let parsed;
        try {
            parsed = JSON.parse(jsonStr);
        } catch (e) {
            throw new Error('解析 JSON 失敗: ' + e.message + '，提取的內容為: ' + jsonStr);
        }

        // 3. 處理 {"name": "add_record", "args": {...}} 或是直接 args 的情況
        let args = parsed;
        if (parsed.name === 'add_record' && parsed.args) {
            args = parsed.args;
        } else if (parsed.args) {
            args = parsed.args;
        }

        // 4. 驗證與強制轉換欄位
        const amount = Number(args.amount);
        if (isNaN(amount) || amount <= 0) {
            throw new Error('AI 未能提取有效的記帳金額');
        }

        return {
            amount: amount,
            category: args.category || '其他',
            account: args.account || '現金',
            description: args.description || '',
            type: args.type === 'income' ? 'income' : 'expense'
        };
    }

    /**
     * 模擬推論回覆，用於在模型加載前的測試
     * @private
     */
    _mockInference(text, categories, accounts) {
        // 從文字中簡單提取數字作為金額
        const amountMatch = text.match(/\d+/);
        const amount = amountMatch ? parseInt(amountMatch[0], 10) : 100;

        // 從文字中尋找符合的分類
        let matchedCategory = categories.find(c => text.includes(c)) || categories[0] || '餐飲';
        // 從文字中尋找符合的帳戶
        let matchedAccount = accounts.find(a => text.includes(a)) || accounts[0] || '現金';

        // 判定是收入還是支出
        const isIncome = text.includes('領') || text.includes('賺') || text.includes('收入') || text.includes('薪水');
        const type = isIncome ? 'income' : 'expense';

        // 去除數字與帳戶名字，作為描述
        let description = text
            .replace(/\d+/g, '')
            .replace(matchedCategory, '')
            .replace(matchedAccount, '')
            .replace(/[元|塊|花了|剛|刷]/g, '')
            .trim();

        if (!description) {
            description = isIncome ? '收入' : '消費';
        }

        return `<tool_call>{"name": "add_record", "args": {"amount": ${amount}, "category": "${matchedCategory}", "account": "${matchedAccount}", "description": "${description}", "type": "${type}"}}</tool_call>`;
    }
}
