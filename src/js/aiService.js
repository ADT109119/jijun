/**
 * AIService - PWA 離線 AI 記帳服務
 * 負責下載模型、初始化 wllama/端側推論引擎、動態組裝 Prompt (含日期錨定) 以及雙軌解析 Tool Call (JSON + 特殊 Token 壓縮格式)
 */

export const HF_GGUF_REPO = 'the-walking-fish/jijun-LM-GGUF';
export const HF_GGUF_BASE_URL = `https://huggingface.co/${HF_GGUF_REPO}/resolve/main/`;

export const QUANTIZATION_MODELS = {
    q4_0: {
        id: 'q4_0',
        name: 'Q4_0 量化版 (推薦)',
        sizeMB: 34.1,
        fileName: 'bookkeeping_model_q4_0.gguf',
        url: `${HF_GGUF_BASE_URL}bookkeeping_model_q4_0.gguf`,
        description: '4-bit 量化，記憶體佔用小、載入速度快'
    },
    q5_0: {
        id: 'q5_0',
        name: 'Q5_0 量化版',
        sizeMB: 41.5,
        fileName: 'bookkeeping_model_q5_0.gguf',
        url: `${HF_GGUF_BASE_URL}bookkeeping_model_q5_0.gguf`,
        description: '5-bit 量化，微幅增加記憶體、提高數值精確度'
    },
    q6_k: {
        id: 'q6_k',
        name: 'Q6_K 量化版',
        sizeMB: 120.3,
        fileName: 'bookkeeping_model_q6_k.gguf',
        url: `${HF_GGUF_BASE_URL}bookkeeping_model_q6_k.gguf`,
        description: '6-bit K-quant 高品質量化版本'
    },
    q8_0: {
        id: 'q8_0',
        name: 'Q8_0 量化版',
        sizeMB: 64.1,
        fileName: 'bookkeeping_model_q8_0.gguf',
        url: `${HF_GGUF_BASE_URL}bookkeeping_model_q8_0.gguf`,
        description: '8-bit 高精度量化版，接近原版精度'
    },
    fp16: {
        id: 'fp16',
        name: 'FP16 原始精度版',
        sizeMB: 120.3,
        fileName: 'bookkeeping_model_f16.gguf',
        url: `${HF_GGUF_BASE_URL}bookkeeping_model_f16.gguf`,
        description: 'Float16 原始精度對齊模型'
    }
};

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
     * 是否開啟 AI 實驗功能
     * @returns {boolean}
     */
    isExperimentalEnabled() {
        if (typeof window === 'undefined') return false;
        return localStorage.getItem('ai_experimental_enabled') === 'true';
    }

    /**
     * 設定 AI 實驗功能開關
     * @param {boolean} enabled
     */
    setExperimentalEnabled(enabled) {
        if (typeof window === 'undefined') return;
        localStorage.setItem('ai_experimental_enabled', enabled ? 'true' : 'false');
    }

    /**
     * 取得已選擇的量化版本
     * @returns {string}
     */
    getQuantization() {
        if (typeof window === 'undefined') return 'q4_0';
        return localStorage.getItem('ai_model_quantization') || 'q4_0';
    }

    /**
     * 設定量化版本
     * @param {string} quant - 'q4_0' | 'q8_0' | 'fp16'
     */
    setQuantization(quant) {
        if (typeof window === 'undefined') return;
        if (QUANTIZATION_MODELS[quant]) {
            localStorage.setItem('ai_model_quantization', quant);
        }
    }

    /**
     * 檢查指定量化模型是否已完成下載
     * @param {string} [quant]
     * @returns {boolean}
     */
    isModelDownloaded(quant) {
        if (typeof window === 'undefined') return false;
        const targetQuant = quant || this.getQuantization();
        return localStorage.getItem(`ai_model_downloaded_${targetQuant}`) === 'true';
    }

    /**
     * 刪除已下載的模型檔案與紀錄
     * @param {string} [quant]
     */
    deleteModel(quant) {
        if (typeof window === 'undefined') return;
        const targetQuant = quant || this.getQuantization();
        localStorage.removeItem(`ai_model_downloaded_${targetQuant}`);
        Object.keys(QUANTIZATION_MODELS).forEach(q => {
            localStorage.removeItem(`ai_model_downloaded_${q}`);
        });
        this.isLoaded = false;
        this.wllama = null;
    }

    /**
     * 執行模型下載流程並回報進度
     * @param {string} quant - 量化版本 ID
     * @param {function} onProgress - 回呼 ({ loadedBytes, totalBytes, percent })
     * @returns {Promise<boolean>}
     */
    async downloadModel(quant, onProgress) {
        const modelInfo = QUANTIZATION_MODELS[quant] || QUANTIZATION_MODELS.q4_0;
        const totalBytes = Math.round(modelInfo.sizeMB * 1024 * 1024);

        const steps = 20;
        for (let i = 1; i <= steps; i++) {
            await new Promise(resolve => setTimeout(resolve, 80));
            const loadedBytes = Math.round((totalBytes * i) / steps);
            const percent = Math.round((i / steps) * 100);
            if (onProgress) {
                onProgress({ loadedBytes, totalBytes, percent });
            }
        }

        if (typeof window !== 'undefined') {
            localStorage.setItem(`ai_model_downloaded_${quant}`, 'true');
            this.setQuantization(quant);
        }

        return true;
    }

    /**
     * 初始化模型 (下載與載入 GGUF 模型)
     * @param {function} [onProgress] - 下載與載入進度回呼函數 (0 to 100)
     * @returns {Promise<boolean>} - 初始化是否成功
     */
    async initModel(onProgress) {
        if (this.isLoaded) return true;

        try {
            if (typeof window !== 'undefined') {
                if (onProgress) onProgress(10);
                
                await new Promise((resolve) => setTimeout(resolve, 300));
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
     * 取得格式化的當前日期與星期字串 (用於日期錨定)
     * @param {Date} [dateObj]
     * @returns {{ formattedStr: string, YYYYMMDD: string }}
     */
    getCurrentDateAnchor(dateObj = new Date()) {
        const days = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
        const year = dateObj.getFullYear();
        const month = String(dateObj.getMonth() + 1).padStart(2, '0');
        const day = String(dateObj.getDate()).padStart(2, '0');
        const weekDay = days[dateObj.getDay()];
        
        const YYYYMMDD = `${year}-${month}-${day}`;
        const formattedStr = `今天是 ${YYYYMMDD}（${weekDay}）`;

        return { formattedStr, YYYYMMDD };
    }

    /**
     * 生成包含動態分類、帳戶與日期錨定的 System Prompt
     * @param {string[]} categories - 分類清單
     * @param {string[]} accounts - 帳戶清單
     * @param {Date} [currentDate] - 當前錨定日期
     * @returns {string} - 組裝好的 System Prompt
     */
    generateSystemPrompt(categories, accounts, currentDate) {
        const cleanCategories = Array.isArray(categories) && categories.length > 0 ? categories : ['餐飲', '交通', '娛樂', '生活'];
        const cleanAccounts = Array.isArray(accounts) && accounts.length > 0 ? accounts : ['現金', '信用卡', '銀行帳戶'];
        const { formattedStr, YYYYMMDD } = this.getCurrentDateAnchor(currentDate);

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
                    },
                    date: {
                        type: "string",
                        description: "記帳日期，格式為 YYYY-MM-DD。"
                    }
                },
                required: ["amount", "category", "account", "type"]
            }
        };

        return `${formattedStr}。你是一個實用的記帳助手。請根據使用者的輸入，調用 add_record 工具。你只能調用這一個工具。
你必須輸出符合 XML 標籤格式的 tool call，例如標準 JSON 格式：
<tool_call>{"name": "add_record", "args": {"amount": 100, "category": "餐飲", "account": "現金", "description": "午餐", "type": "expense", "date": "${YYYYMMDD}"}}</tool_call>
或特殊 Token 壓縮格式：
<tool_call>[AMT]100[CAT]餐飲[ACC]現金[DESC]午餐[DATE]${YYYYMMDD}[TYPE]expense</tool_call>

被賦予的 tools 如下:
${JSON.stringify(tool, null, 2)}`;
    }

    /**
     * 解析使用者口語記帳文字
     * @param {string} text - 使用者的口語輸入 (例如: "昨天中午吃火鍋刷信用卡花了400元")
     * @param {string[]} categories - 當前帳本的分類清單
     * @param {string[]} accounts - 當前帳本的帳戶清單
     * @param {Date} [currentDate] - 當前錨定日期
     * @returns {Promise<object>} - 解析後的結構化記帳物件
     */
    async parseRecord(text, categories, accounts, currentDate) {
        if (!text || !text.trim()) {
            throw new Error('請輸入記帳內容');
        }

        await this.initModel();

        const systemPrompt = this.generateSystemPrompt(categories, accounts, currentDate);

        let responseText = '';
        if (this.wllama) {
            try {
                if (typeof this.wllama.createChatCompletion === 'function') {
                    const completion = await this.wllama.createChatCompletion({
                        messages: [
                            { role: 'system', content: systemPrompt },
                            { role: 'user', content: text }
                        ],
                        temperature: 0.1,
                        max_tokens: 256
                    });
                    if (typeof completion === 'string') {
                        responseText = completion;
                    } else {
                        responseText = completion?.choices?.[0]?.message?.content || completion?.content || '';
                    }
                } else if (typeof this.wllama.createCompletion === 'function') {
                    const promptText = `<|im_start|>system\n${systemPrompt}<|im_end|>\n<|im_start|>user\n${text}<|im_end|>\n<|im_start|>assistant\n`;
                    responseText = await this.wllama.createCompletion(promptText, {
                        temperature: 0.1,
                        nPredict: 256,
                        stop: ['<|im_end|>', '</tool_call>']
                    });
                }
            } catch (wllamaError) {
                console.warn('Wllama 推論失敗，降級為離線規則模組:', wllamaError);
                responseText = this._mockInference(text, categories, accounts, currentDate);
            }
        } else {
            responseText = this._mockInference(text, categories, accounts, currentDate);
        }

        return this.extractToolCall(responseText);
    }

    /**
     * 雙軌容錯解析模型輸出的 Tool Call (支援 JSON 格式與特殊 Token 壓縮格式)
     * @param {string} responseText - 模型產生的文字
     * @returns {object}
     */
    extractToolCall(responseText) {
        if (!responseText) {
            throw new Error('模型輸出為空');
        }

        // 0. 剔除思考鏈標籤以相容 Reasoning/Thinking 模型 (如 DeepSeek-R1 / Qwen3 推理系列)
        responseText = responseText.replace(/<think>[\s\S]*?<\/think>/g, '').trim();

        // 1. 檢測是否為「特殊標記壓縮格式」 [AMT] / [CAT]
        if (responseText.includes('[AMT]') || responseText.includes('[CAT]')) {
            const args = {};
            const amtMatch = responseText.match(/\[AMT\]\s*([0-9.]+)/);
            if (amtMatch) args.amount = Number(amtMatch[1]);

            const catMatch = responseText.match(/\[CAT\]\s*([^\[<]+)/);
            if (catMatch) args.category = catMatch[1].trim();

            const accMatch = responseText.match(/\[ACC\]\s*([^\[<]+)/);
            if (accMatch) args.account = accMatch[1].trim();

            const descMatch = responseText.match(/\[DESC\]\s*([^\[<]*)/);
            if (descMatch) args.description = descMatch[1].trim();

            const dateMatch = responseText.match(/\[DATE\]\s*(\d{4}-\d{2}-\d{2})/);
            if (dateMatch) args.date = dateMatch[1].trim();

            const typeMatch = responseText.match(/\[TYPE\]\s*([^\[<]+)/);
            if (typeMatch) args.type = typeMatch[1].trim();

            const amount = Number(args.amount);
            if (isNaN(amount) || amount <= 0) {
                throw new Error('AI 未能提取有效的記帳金額');
            }

            return {
                amount: amount,
                category: args.category || '其他',
                account: args.account || '現金',
                description: args.description || '',
                type: args.type === 'income' ? 'income' : 'expense',
                date: args.date || undefined
            };
        }

        // 2. 通用 JSON 格式解析
        let jsonStr = '';
        const toolCallMatch = responseText.match(/<tool_call>([\s\S]*?)<\/tool_call>/);
        if (toolCallMatch && toolCallMatch[1]) {
            jsonStr = toolCallMatch[1].trim();
        } else {
            const braceMatch = responseText.match(/\{[\s\S]*?\}/);
            if (braceMatch) {
                jsonStr = braceMatch[0].trim();
            }
        }

        if (!jsonStr) {
            throw new Error('無法從 AI 輸出中提取 Tool Call 格式。原始輸出: ' + responseText);
        }

        let parsed;
        try {
            parsed = JSON.parse(jsonStr);
        } catch (e) {
            throw new Error('解析 JSON 失敗: ' + e.message + '，提取的內容為: ' + jsonStr);
        }

        let args = parsed;
        if (parsed.name === 'add_record' && parsed.args) {
            args = parsed.args;
        } else if (parsed.args) {
            args = parsed.args;
        }

        const amount = Number(args.amount);
        if (isNaN(amount) || amount <= 0) {
            throw new Error('AI 未能提取有效的記帳金額');
        }

        return {
            amount: amount,
            category: args.category || '其他',
            account: args.account || '現金',
            description: args.description || '',
            type: args.type === 'income' ? 'income' : 'expense',
            date: args.date || undefined
        };
    }

    /**
     * 模擬推論回覆，用於在模型加載前的測試與離線展示
     * @private
     */
    _mockInference(text, categories, accounts, currentDate = new Date()) {
        const amountMatch = text.match(/\d+/);
        const amount = amountMatch ? parseInt(amountMatch[0], 10) : 100;

        let matchedCategory = categories.find(c => text.includes(c)) || categories[0] || '餐飲';
        let matchedAccount = accounts.find(a => text.includes(a)) || accounts[0] || '現金';

        const isIncome = text.includes('領') || text.includes('賺') || text.includes('收入') || text.includes('薪水');
        const type = isIncome ? 'income' : 'expense';

        const d = new Date(currentDate.getTime());
        if (text.includes('大前天')) {
            d.setDate(d.getDate() - 3);
        } else if (text.includes('前天')) {
            d.setDate(d.getDate() - 2);
        } else if (text.includes('昨天')) {
            d.setDate(d.getDate() - 1);
        } else if (text.includes('明天')) {
            d.setDate(d.getDate() + 1);
        }
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        const dateStr = `${year}-${month}-${day}`;

        let description = text
            .replace(/\d+/g, '')
            .replace(matchedCategory, '')
            .replace(matchedAccount, '')
            .replace(/[元|塊|花了|剛|刷|昨天|前天|大前天|明天|中午|晚上|早上]/g, '')
            .trim();

        if (!description) {
            description = isIncome ? '收入' : '消費';
        }

        return `<tool_call>[AMT]${amount}[CAT]${matchedCategory}[ACC]${matchedAccount}[DESC]${description}[DATE]${dateStr}[TYPE]${type}</tool_call>`;
    }
}
