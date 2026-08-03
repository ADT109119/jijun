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
        sizeMB: 41.6,
        fileName: 'bookkeeping_model_q5_0.gguf',
        url: `${HF_GGUF_BASE_URL}bookkeeping_model_q5_0.gguf`,
        description: '5-bit 量化，微幅增加記憶體、提高數值精確度'
    },
    q6_k: {
        id: 'q6_k',
        name: 'Q6_K 量化版',
        sizeMB: 240.3,
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

        /** @type {string} 解析模式 ('llm' | 'rules') */
        this.lastMode = 'llm';

        /** @type {string} 降級原因階段 ('' | 'init' | 'inference') */
        this.lastErrorStage = '';

        /** @type {Promise<any>|null} wllama 引擎動態載入快取 */
        this._enginePromise = null;
    }

    /** 動態載入本地 wllama 引擎類別（僅瀏覽器） */
    async _loadEngine() {
        if (this._enginePromise) return this._enginePromise;
        if (typeof window === 'undefined') {
            throw new Error('wllama 引擎僅能在瀏覽器端載入');
        }
        this._enginePromise = (async () => {
            const mod = await import('../vendor/wllama/index.js');
            return mod.Wllama;
        })();
        return this._enginePromise;
    }

    /** 建立並返回 wllama 實例（本地 wasm、關閉 CDN compat 以維持離線） */
    async _createWllama() {
        const Wllama = await this._loadEngine();
        const inst = new Wllama(
            { default: '/vendor/wllama/esm/wasm/wllama.wasm' },
            { allowOffline: true, suppressNativeLog: true }
        );
        inst.setCompat(null);
        return inst;
    }

    /** 將 wllama 進度 ({loaded,total}) 轉成 UI 統一形狀 {loadedBytes,totalBytes,percent} */
    _normalizeProgress(onProgress) {
        if (typeof onProgress !== 'function') return () => {};
        return ({ loaded, total }) => {
            if (total <= 0) return;
            onProgress({
                loadedBytes: loaded,
                totalBytes: total,
                percent: Math.min(100, Math.round((loaded / total) * 100))
            });
        };
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

    /** 私有：安全釋放既有 wllama 實例以避免 Module is already initialized 錯誤 */
    async _ensureUnloaded() {
        if (this.wllama) {
            try {
                if (typeof this.wllama.exit === 'function') {
                    await this.wllama.exit();
                }
            } catch (e) {
                /* ignore */
            }
            this.wllama = null;
            this.isLoaded = false;
        }
    }

    /**
     * 刪除已下載的模型檔案與紀錄
     */
    async deleteModel() {
        await this._ensureUnloaded();
        if (typeof window !== 'undefined') {
            Object.keys(QUANTIZATION_MODELS).forEach(q => {
                localStorage.removeItem(`ai_model_downloaded_${q}`);
                localStorage.removeItem(`ai_model_etag_${q}`);
                localStorage.removeItem(`ai_model_update_available_${q}`);
                localStorage.removeItem(`ai_model_last_check_time_${q}`);
            });
        }
        this.lastMode = 'llm';
        this.lastErrorStage = '';
    }

    /**
     * 執行模型下載流程並回報進度
     * @param {string} quant - 量化版本 ID
     * @param {function} onProgress - 回呼 ({ loadedBytes, totalBytes, percent })
     * @returns {Promise<boolean>}
     */
    async downloadModel(quant, onProgress) {
        const modelInfo = QUANTIZATION_MODELS[quant] || QUANTIZATION_MODELS.q4_0;
        await this._ensureUnloaded();
        this.wllama = await this._createWllama();
        const report = this._normalizeProgress(onProgress);
        try {
            await this.wllama.loadModelFromUrl(modelInfo.url, {
                useCache: true,
                n_ctx: 2048,
                progressCallback: report
            });
            // 完整性軟檢查：確認 OPFS 有該檔且長度合理
            try {
                const name = await this.wllama.cacheManager.getNameFromURL(modelInfo.url);
                const meta = await this.wllama.cacheManager.getMetadata(name);
                if (!meta || !meta.originalSize) {
                    throw new Error('模型快取中缺少完整性後設資料');
                }
            } catch (integrityError) {
                this.isLoaded = false;
                throw integrityError;
            }

            // 抓取伺服器 ETag 作為本地版次基準
            try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 3000);
                const headRes = await fetch(modelInfo.url, { method: 'HEAD', signal: controller.signal });
                clearTimeout(timeoutId);
                if (headRes.ok) {
                    const etag = headRes.headers.get('etag') || headRes.headers.get('x-linked-etag');
                    if (etag && typeof window !== 'undefined') {
                        localStorage.setItem(`ai_model_etag_${modelInfo.id}`, etag);
                    }
                }
            } catch (e) {
                // 靜默防護：下載已成功，即使 HEAD 取得 ETag 失敗不影響運作
            }

            this.isLoaded = true;
            this._markDownloaded(modelInfo.id);
            if (typeof window !== 'undefined') {
                localStorage.removeItem(`ai_model_update_available_${modelInfo.id}`);
            }
            return true;
        } catch (error) {
            this.isLoaded = false;
            console.error('AI 模型下載失敗:', error);
            throw error;
        }
    }

    /**
     * 檢查指定量化模型是否有新版本可更新 (帶 12 小時冷卻與 3 秒靜默逾時防禦)
     * @param {string} [quant]
     * @returns {Promise<{hasUpdate: boolean, etag?: string}>}
     */
    async checkForModelUpdate(quant) {
        if (typeof window === 'undefined' || !navigator.onLine) {
            return { hasUpdate: false };
        }
        const targetQuant = quant || this.getQuantization();
        if (!this.isModelDownloaded(targetQuant)) {
            return { hasUpdate: false };
        }

        const modelInfo = QUANTIZATION_MODELS[targetQuant] || QUANTIZATION_MODELS.q4_0;
        const lastCheckKey = `ai_model_last_check_time_${targetQuant}`;
        const hasUpdateKey = `ai_model_update_available_${targetQuant}`;
        const etagKey = `ai_model_etag_${targetQuant}`;

        const lastCheck = parseInt(localStorage.getItem(lastCheckKey) || '0', 10);
        const now = Date.now();
        // 12 小時冷卻時間
        if (now - lastCheck < 12 * 60 * 60 * 1000) {
            return { hasUpdate: localStorage.getItem(hasUpdateKey) === 'true' };
        }

        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 3000);
            const response = await fetch(modelInfo.url, {
                method: 'HEAD',
                signal: controller.signal
            });
            clearTimeout(timeoutId);

            if (!response.ok) {
                return { hasUpdate: localStorage.getItem(hasUpdateKey) === 'true' };
            }

            const remoteEtag = response.headers.get('etag') || response.headers.get('x-linked-etag');
            const localEtag = localStorage.getItem(etagKey);

            localStorage.setItem(lastCheckKey, now.toString());

            if (remoteEtag && localEtag && remoteEtag !== localEtag) {
                localStorage.setItem(hasUpdateKey, 'true');
                return { hasUpdate: true, etag: remoteEtag };
            } else if (remoteEtag && !localEtag) {
                localStorage.setItem(etagKey, remoteEtag);
                localStorage.setItem(hasUpdateKey, 'false');
                return { hasUpdate: false };
            } else {
                localStorage.setItem(hasUpdateKey, 'false');
                return { hasUpdate: false };
            }
        } catch (e) {
            return { hasUpdate: localStorage.getItem(hasUpdateKey) === 'true' };
        }
    }

    /**
     * 查詢指定量化模型是否有可用的更新
     * @param {string} [quant]
     * @returns {boolean}
     */
    hasModelUpdate(quant) {
        if (typeof window === 'undefined') return false;
        const targetQuant = quant || this.getQuantization();
        return localStorage.getItem(`ai_model_update_available_${targetQuant}`) === 'true';
    }

    /** 私有：記錄某量化版本已完成下載 */
    _markDownloaded(quant) {
        if (typeof window === 'undefined') return;
        localStorage.setItem(`ai_model_downloaded_${quant}`, 'true');
        this.setQuantization(quant);
    }

    /**
     * 初始化模型 (下載與載入 GGUF 模型)
     * @param {function} [onProgress] - 下載與載入進度回呼函數 ({ loadedBytes, totalBytes, percent })
     * @returns {Promise<boolean>} - 初始化是否成功
     */
    async initModel(onProgress) {
        if (this.isLoaded && this.wllama) return true;
        const modelInfo = QUANTIZATION_MODELS[this.getQuantization()] || QUANTIZATION_MODELS.q4_0;
        const downloaded = (typeof window !== 'undefined') &&
            localStorage.getItem(`ai_model_downloaded_${modelInfo.id}`) === 'true';
        try {
            if (!downloaded) {
                throw new Error('AI 模型尚未設定，請先到設定下載模型');
            }
            if (onProgress) onProgress({ loadedBytes: 0, totalBytes: 0, percent: 5 });
            if (!this.wllama) {
                await this._ensureUnloaded();
                this.wllama = await this._createWllama();
            }
            const report = this._normalizeProgress(onProgress);
            await this.wllama.loadModelFromUrl(modelInfo.url, {
                useCache: true,
                n_ctx: 2048,
                progressCallback: report
            });
            this.isLoaded = true;
            if (onProgress) onProgress({ loadedBytes: 0, totalBytes: 0, percent: 100 });
            return true;
        } catch (error) {
            this.isLoaded = false;
            console.error('AI 模型初始化失敗:', error);
            throw error;
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
     * 生成包含動態分類、帳戶與日期錨定的 System Prompt (對齊 demo_gguf.py 訓練規範)
     * @param {string[]} categories - 分類清單
     * @param {string[]} accounts - 帳戶清單
     * @param {Date} [currentDate] - 當前錨定日期
     * @returns {string} - 組裝好的 System Prompt
     */
    generateSystemPrompt(categories, accounts, currentDate) {
        const cleanCategories = Array.isArray(categories) && categories.length > 0 ? categories : ['餐飲', '日常', '交通', '娛樂', '醫療', '教育', '還款', '薪水', '獎金', '零用錢', '兼職', '投資', '利息', '欠款回收', '其他'];
        const cleanAccounts = Array.isArray(accounts) && accounts.length > 0 ? accounts : ['現金', '信用卡', '悠遊卡', '一卡通', '街口支付', 'LINE Pay', 'Apple Pay', 'Google Pay', '郵局帳戶', '銀行存款', '外幣帳戶', '加密貨幣', '悠遊付', 'icash'];
        const { formattedStr } = this.getCurrentDateAnchor(currentDate);

        const toolDef = {
            name: "add_record",
            description: "新增一筆記帳記錄",
            parameters: {
                type: "object",
                properties: {
                    amount: { type: "number" },
                    category: { type: "string", enum: cleanCategories },
                    account: { type: "string", enum: cleanAccounts },
                    description: { type: "string" },
                    type: { type: "string", enum: ["expense", "income"] },
                    date: { type: "string", description: "ISO 8601 格式日期，例如 YYYY-MM-DD" }
                },
                required: ["amount", "category", "account", "type", "date"]
            }
        };

        return `${formattedStr}。你是一個記帳助理。你被賦予了以下 tools:\n${JSON.stringify(toolDef)}`;
    }

    /**
     * 解析使用者口語記帳文字 (支援流式 Token 回呼)
     * @param {string} text - 使用者的口語輸入 (例如: "昨天中午吃火鍋刷信用卡花了400元")
     * @param {string[]} categories - 當前帳本的分類清單
     * @param {string[]} accounts - 當前帳本的帳戶清單
     * @param {Date} [currentDate] - 當前錨定日期
     * @param {function} [onToken] - 即時流式生成回呼 (piece, currentText) => void
     * @returns {Promise<object>} - 解析後的結構化記帳物件
     */
    async parseRecord(text, categories, accounts, currentDate, onToken) {
        if (!text || !text.trim()) {
            throw new Error('請輸入記帳內容');
        }

        const systemPrompt = this.generateSystemPrompt(categories, accounts, currentDate);

        try {
            await this.initModel();
            this.lastErrorStage = '';
            const promptText = `<|im_start|>system\n${systemPrompt}<|im_end|>\n` +
                `<|im_start|>user\n${text}<|im_end|>\n<|im_start|>assistant\n`;
            let responseText = '';
            try {
                const isStreaming = typeof onToken === 'function';
                const completionOpts = {
                    prompt: promptText,
                    temperature: 0.1,
                    max_tokens: 128,
                    stop: ['<|im_end|>', '</tool_call>']
                };

                if (isStreaming) {
                    completionOpts.stream = true;
                    completionOpts.onData = (chunk) => {
                        const piece = chunk?.choices?.[0]?.text || chunk?.choices?.[0]?.delta?.content || (typeof chunk === 'string' ? chunk : '');
                        if (piece) {
                            responseText += piece;
                            onToken(piece, responseText);
                        }
                    };
                }

                const response = await this.wllama.createCompletion(completionOpts);
                if (!responseText && response?.choices?.[0]?.text) {
                    responseText = response.choices[0].text;
                }
            } catch (error) {
                this.lastErrorStage = 'inference';
                throw error;
            }
            this.lastMode = 'llm';
            return this.extractToolCall(responseText);
        } catch (error) {
            if (!this.lastErrorStage) this.lastErrorStage = 'init';
            console.warn(`wllama ${this.lastErrorStage} 失敗，降級為離線規則模組:`, error);
            this.lastMode = 'rules';
            return this.extractToolCall(this._ruleInference(text, categories, accounts, currentDate));
        }
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

            const catMatch = responseText.match(/\[CAT\]\s*([^[<]+)/);
            if (catMatch) args.category = catMatch[1].trim();

            const accMatch = responseText.match(/\[ACC\]\s*([^[<]+)/);
            if (accMatch) args.account = accMatch[1].trim();

            const descMatch = responseText.match(/\[DESC\]\s*([^[<]*)/);
            if (descMatch) args.description = descMatch[1].trim();

            const dateMatch = responseText.match(/\[DATE\]\s*(\d{4}-\d{2}-\d{2})/);
            if (dateMatch) args.date = dateMatch[1].trim();

            const typeMatch = responseText.match(/\[TYPE\]\s*([^[<]+)/);
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
     * 離線規則推論回覆，用於在模型加載前的測試、降級與離線展示
     * @private
     */
    _ruleInference(text, categories, accounts, currentDate = new Date()) {
        const amountMatch = text.match(/\d+/);
        const amount = amountMatch ? parseInt(amountMatch[0], 10) : 100;

        const matchedCategory = categories.find(c => text.includes(c)) || categories[0] || '餐飲';
        const matchedAccount = accounts.find(a => text.includes(a)) || accounts[0] || '現金';

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
