/**
 * AIService - PWA 離線 AI 記帳服務
 * 負責下載模型、初始化 wllama/端側推論引擎、動態組裝 Prompt (含日期錨定) 以及雙軌解析 Tool Call (JSON + 特殊 Token 壓縮格式)
 */

import { buildSystemPrompt, parseToolCalls, extractBalancedJson } from './toolsSchema.js';
import { CATEGORIES } from './categories.js';

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
            const prevQuant = localStorage.getItem('ai_model_quantization');
            localStorage.setItem('ai_model_quantization', quant);
            if (prevQuant && prevQuant !== quant) {
                this._ensureUnloaded().catch(() => {});
            }
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
     * 從遠端 HEAD 取得模型檔案的 ETag/SHA-256 雜湊值 (帶超時防禦)
     * @param {string} url
     * @returns {Promise<string|null>}
     */
    async fetchRemoteModelHash(url) {
        if (typeof window === 'undefined' || !navigator.onLine) return null;
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 4000);
            const res = await fetch(url, {
                method: 'HEAD',
                cache: 'no-cache',
                signal: controller.signal
            });
            clearTimeout(timeoutId);
            if (!res.ok) return null;
            const etag = res.headers.get('etag') || res.headers.get('x-linked-etag');
            if (!etag) return null;
            return etag.replace(/^W\//, '').replace(/"/g, '').trim();
        } catch (e) {
            return null;
        }
    }

    /**
     * 刪除已下載的模型檔案與紀錄 (徹底清理 OPFS 快取實體)
     * @param {string} [quant] - 指定刪除的量化版本，若未提供則清理所有模型
     */
    async deleteModel(quant) {
        await this._ensureUnloaded();

        // 真實清理 OPFS 快取檔案實體
        try {
            const Wllama = await this._loadEngine();
            const inst = new Wllama(
                { default: '/vendor/wllama/esm/wasm/wllama.wasm' },
                { allowOffline: true, suppressNativeLog: true }
            );
            if (quant && QUANTIZATION_MODELS[quant]) {
                await inst.cacheManager.delete(QUANTIZATION_MODELS[quant].url);
            } else {
                await inst.cacheManager.clear();
            }
            if (typeof inst.exit === 'function') {
                await inst.exit();
            }
        } catch (cacheErr) {
            console.warn('清理 OPFS 模型快取失敗或不支援:', cacheErr);
        }

        if (typeof window !== 'undefined') {
            const targets = quant ? [quant] : Object.keys(QUANTIZATION_MODELS);
            targets.forEach(q => {
                localStorage.removeItem(`ai_model_downloaded_${q}`);
                localStorage.removeItem(`ai_model_etag_${q}`);
                localStorage.removeItem(`ai_model_update_available_${q}`);
                localStorage.removeItem(`ai_model_last_check_time_${q}`);
                localStorage.removeItem(`ai_model_remote_etag_${q}`);
            });
        }
        this.lastMode = 'llm';
        this.lastErrorStage = '';
    }

    /**
     * 執行模型下載流程並回報進度 (主動比對遠端 Hash 並清理舊快取以確保獲取最新模型)
     * @param {string} quant - 量化版本 ID
     * @param {function} onProgress - 回呼 ({ loadedBytes, totalBytes, percent })
     * @param {object} [options] - 選項 { forceDownload?: boolean }
     * @returns {Promise<boolean>}
     */
    async downloadModel(quant, onProgress, options = {}) {
        const modelInfo = QUANTIZATION_MODELS[quant] || QUANTIZATION_MODELS.q4_0;
        await this._ensureUnloaded();
        this.wllama = await this._createWllama();
        const report = this._normalizeProgress(onProgress);
        try {
            // 下載前先連網取得遠端最新的 ETag (SHA-256)
            const remoteHash = await this.fetchRemoteModelHash(modelInfo.url);

            // 清理舊快取以確保真正重新下載：
            // 如果本地 OPFS 中已有快取檔且需要更新或重新下載，必須先行刪除舊快取
            if (this.wllama && this.wllama.cacheManager) {
                try {
                    await this.wllama.cacheManager.delete(modelInfo.url);
                } catch (delErr) {
                    console.warn('清理舊模型快取時略過:', delErr);
                }
            }

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

            // 保存最新 ETag/Hash 作為版本基準
            if (remoteHash && typeof window !== 'undefined') {
                localStorage.setItem(`ai_model_etag_${modelInfo.id}`, remoteHash);
            }

            this.isLoaded = true;
            this._markDownloaded(modelInfo.id);
            if (typeof window !== 'undefined') {
                localStorage.removeItem(`ai_model_update_available_${modelInfo.id}`);
                localStorage.removeItem(`ai_model_remote_etag_${modelInfo.id}`);
            }
            return true;
        } catch (error) {
            this.isLoaded = false;
            console.error('AI 模型下載失敗:', error);
            throw error;
        }
    }

    /**
     * 檢查指定量化模型是否有新版本可更新 (支援 Hash 比對與 options.force 強制檢查)
     * @param {string} [quant]
     * @param {object} [options] - { force?: boolean }
     * @returns {Promise<{hasUpdate: boolean, etag?: string, localEtag?: string}>}
     */
    async checkForModelUpdate(quant, options = {}) {
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
        // 若非強制檢查，帶 12 小時冷卻時間
        if (!options.force && (now - lastCheck < 12 * 60 * 60 * 1000)) {
            return { hasUpdate: localStorage.getItem(hasUpdateKey) === 'true' };
        }

        try {
            const remoteHash = await this.fetchRemoteModelHash(modelInfo.url);
            if (!remoteHash) {
                return { hasUpdate: localStorage.getItem(hasUpdateKey) === 'true' };
            }

            const rawLocalEtag = localStorage.getItem(etagKey);
            const localHash = rawLocalEtag ? rawLocalEtag.replace(/^W\//, '').replace(/"/g, '').trim() : '';

            localStorage.setItem(lastCheckKey, now.toString());

            // 雜湊比對：若遠端 Hash 與本地不同，或者本地尚無 ETag 記錄（舊版過渡），標記有更新
            if (remoteHash && (!localHash || remoteHash !== localHash)) {
                localStorage.setItem(hasUpdateKey, 'true');
                localStorage.setItem(`ai_model_remote_etag_${targetQuant}`, remoteHash);
                return { hasUpdate: true, etag: remoteHash, localEtag: localHash };
            } else {
                localStorage.setItem(hasUpdateKey, 'false');
                return { hasUpdate: false, etag: remoteHash };
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
     * 生成包含動態分類、帳戶與日期錨定的 System Prompt (對齊 tools.schema.json 與 build_prompt.py 訓練規範)
     * @param {string[]} categories - 分類清單
     * @param {string[]} accounts - 帳戶清單
     * @param {Date} [currentDate] - 當前錨定日期
     * @returns {string} - 組裝好的 System Prompt
     */
    generateSystemPrompt(categories, accounts, currentDate) {
        // 輸入正規化：容忍呼叫端傳入物件陣列（如 {name}）與髒空白，並去重
        // （分類兩側合併時「其他」等重疊分類會重複出現在 enum，冗餘且稀釋權重）
        const rawCategories = Array.isArray(categories) && categories.length > 0
            ? categories.map(c => typeof c === 'string' ? c.trim() : c?.name?.trim() || '').filter(Boolean)
            : [];
        const cleanCategories = rawCategories.length > 0
            ? Array.from(new Set(rawCategories))
            : ['飲食', '日常', '交通', '娛樂', '醫療', '教育', '還款', '薪水', '獎金', '零用錢', '兼職', '投資', '利息', '欠款回收', '其他'];

        const rawAccounts = Array.isArray(accounts) && accounts.length > 0
            ? accounts.map(a => typeof a === 'string' ? a.trim() : a?.name?.trim() || '').filter(Boolean)
            : [];
        const cleanAccounts = rawAccounts.length > 0
            ? Array.from(new Set(rawAccounts))
            : ['現金', '信用卡', '悠遊卡', '一卡通', '街口支付', 'LINE Pay', 'Apple Pay', 'Google Pay', '郵局帳戶', '銀行存款', '外幣帳戶', '加密貨幣', '悠遊付', 'icash'];

        // Protocol v2：委托 toolsSchema.js 組裝（v1 單工具模式），與訓練端
        // gen/build_prompt.py 的 prompt 位元完全一致。
        // descriptions.date 覆寫為訓練集變體（「僅日期精度」），對齊
        // tools/jijun-ai-training/tools.schema.json 的實際訓練字串。
        // 收支類型規則不再寫入 prompt（規則文字會偏離訓練集分佈），
        // 改由 applySemanticGuardrail() 於解析後做高確信度關鍵字校正 (#64)。
        return buildSystemPrompt(['add_record'], currentDate || new Date(), {
            category: cleanCategories,
            account: cleanAccounts
        }, {
            descriptions: {
                add_record: {
                    date: 'ISO 8601 格式日期，僅日期精度，例如 YYYY-MM-DD'
                }
            }
        });
    }

    /**
     * 智慧模糊匹配帳戶 (支援大小寫/空白忽略、子字串包含、語意別名與編輯距離容錯)
     * @param {string} predicted
     * @param {Array<object>} accounts
     * @returns {object|null}
     */
    fuzzyMatchAccount(predicted, accounts) {
        return fuzzyMatchAccount(predicted, accounts);
    }

    /**
     * 智慧模糊匹配分類 (支援大小寫/空白忽略、子字串包含、同義詞映射與編輯距離容錯)
     * @param {string} predicted
     * @param {Array<object>} categories
     * @returns {object|null}
     */
    fuzzyMatchCategory(predicted, categories) {
        return fuzzyMatchCategory(predicted, categories);
    }

    /**
     * 前端語意守門校正：針對高確信度關鍵字進行收支類型校準，防止小模型幻覺 (#64)
     * @param {object} record - 解析後的記帳物件
     * @param {string} rawText - 原始使用者輸入文字
     * @returns {object}
     */
    applySemanticGuardrail(record, rawText) {
        if (!record || !rawText || typeof rawText !== 'string') return record;
        const text = rawText.trim();
        const expenseRegex = /(?:花了?|花費|花费|買了?|买了?|購買|购买|付了?|支付|消費|消费|支出|刷了?|結帳|结账|吃了?|喝了?|搭乘?|繳費?|缴费?|扣款)/;
        const incomeRegex = /(?:領了?|領到|领了?|领到|賺了?|賺到|赚了?|赚到|領薪|领薪|發薪|发薪|薪水|工資|工资|入帳|入账|進帳|进账|獎金|奖金|退款|利息)/;

        const hasExpense = expenseRegex.test(text);
        const hasIncome = incomeRegex.test(text);

        if (hasExpense && !hasIncome) {
            record.type = 'expense';
        } else if (hasIncome && !hasExpense) {
            record.type = 'income';
        }
        return record;
    }

    /**
     * 字面分類守門：使用者直接把類別名打成輸入（例「孝親費10000」「孝親費10000給媽」）時，
     * 以原始輸入中「字面出現的最長分類名」覆寫模型選出的分類。
     *
     * 動機（2026-10-14 以 v4c f16 GGUF 實測）：使用者自訂類別名（孝親費/電話費/代墊/股票）
     * 從未出現在訓練 enum 池（訓練集僅見過 213 種名稱），且 byte-level BPE 把「孝親費」
     * 切成 6 個半字元 token，模型讀不出詞、只能套金額先驗 →
     * 「孝親費10000」→ category=教育、description 幻覺成「孫親費」。
     * 訓練端要修得重訓（v4d「類別名回聲」資料族），前端這條是零成本的高確信度兜底。
     *
     * 高確信度條件（避免誤傷）：
     * 1. 名稱長度 >= 2（排除單字類別）
     * 2. 最長名稱優先（同時有「股票」與「股票股利」時選後者）
     * 3. 命中即覆寫 category；僅當模型 description 未字面出現在原文（視為幻覺）時，
     *    才用原文殘句（扣掉金額與類別名）取代，避免把「買晚餐600」的 description 改壞
     * @param {object} record - 解析後的記帳物件
     * @param {string} rawText - 原始使用者輸入文字
     * @param {Array<string|object>} categories - 目前帳本的分類清單
     * @returns {object}
     */
    applyLiteralCategoryGuardrail(record, rawText, categories) {
        if (!record || !rawText || typeof rawText !== 'string') return record;

        let candidateCategories = categories;
        if (Array.isArray(categories)) {
            const incomeNames = new Set((CATEGORIES?.income || []).map(c => c.name).filter(n => n !== '其他' && n !== '其它'));
            const expenseNames = new Set((CATEGORIES?.expense || []).map(c => c.name).filter(n => n !== '其他' && n !== '其它'));

            if (record.type === 'expense') {
                candidateCategories = categories.filter(c => {
                    if (typeof c === 'object' && c !== null) {
                        if (c.type === 'income') return false;
                        if (c.type === 'expense') return true;
                        return !incomeNames.has(c.name);
                    }
                    return !incomeNames.has(c);
                });
            } else if (record.type === 'income') {
                candidateCategories = categories.filter(c => {
                    if (typeof c === 'object' && c !== null) {
                        if (c.type === 'expense') return false;
                        if (c.type === 'income') return true;
                        return !expenseNames.has(c.name);
                    }
                    return !expenseNames.has(c);
                });
            }
        }

        const literal = findLiteralCategoryName(rawText, candidateCategories);
        if (!literal) return record;

        record.category = literal;

        // description 只在模型講了原文沒有的詞（幻覺/崩字）時才接手，
        // 取「原文扣掉類別名與金額」的殘句；殘句為空則回填類別名。
        const desc = typeof record.description === 'string' ? record.description.trim() : '';
        const descIsGrounded = desc.length > 0 && rawText.includes(desc);
        if (!descIsGrounded) {
            const residual = rawText
                .replace(literal, '')
                .replace(/[0-9０-９]+(?:\.[0-9０-９]+)?\s*(?:元|塊|圓|万|萬|k|K|千)?/g, '')
                .replace(/^[，。、\s：:]+|[，。、\s：:]+$/g, '')
                .trim();
            record.description = residual || literal;
        }
        return record;
    }

    /**
     * 從文字中提取第一座完整且平衡的大括號 JSON 物件 (處理字串轉義與任意層級嵌套，防止非貪婪正則截斷)
     * 實作已提升至 toolsSchema.extractBalancedJson（單一真相源，含 stop token
     * 微截斷補齊容錯），本方法保留為相容私人介面。
     * @param {string} text
     * @returns {string|null}
     * @private
     */
    _extractBalancedJson(text) {
        return text ? extractBalancedJson(text) : null;
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
            return this.extractToolCall(responseText, text, categories);
        } catch (error) {
            if (!this.lastErrorStage) this.lastErrorStage = 'init';
            console.warn(`wllama ${this.lastErrorStage} 失敗，降級為離線規則模組:`, error);
            this.lastMode = 'rules';
            return this.extractToolCall(this._ruleInference(text, categories, accounts, currentDate), text, categories);
        }
    }

    /**
     * 雙軌容錯解析模型輸出的 Tool Call (支援 JSON 格式與特殊 Token 壓縮格式)
     * Protocol v2：委托 toolsSchema.parseToolCalls（含 compressed 軌、thinking 標籤
     * 剔除、schema 驗證與動態 enum 模糊匹配）；本方法維持 v1 回傳結構。
     * #64 移植：rawText 語意守門——高確信度關鍵字校正收支類型，防止小模型幻覺。
     * 字面分類守門：rawText 字面含分類名時覆寫分類（使用者自訂類別名模型不認得）。
     * @param {string} responseText - 模型產生的文字
     * @param {string} [rawText] - 原始使用者輸入文字（用於語意守門校準）
     * @param {Array<string|object>} [categories] - 目前帳本分類清單（用於字面分類守門）
     * @returns {object}
     */
    extractToolCall(responseText, rawText = '', categories = []) {
        const { calls } = parseToolCalls(responseText, {
            tools: ['add_record'],
            pools: { category: Array.isArray(categories) ? categories : [] }
        });
        const call = calls[0];

        if (!call.name || call.name !== 'add_record' || !call.args) {
            const reason = call.issues[0] || '無法識別 add_record tool call';
            throw new Error(reason);
        }
        // Protocol v2：解析、思考鏈剔除、compressed 軌、平衡括號與巢狀 JSON
        // 容錯（含 stop token 截斷補齊）、schema 驗證與動態 enum 模糊匹配，全部
        // 委托 toolsSchema.parseToolCalls（單一真相源）。本方法只負責 v1 回傳
        // 結構組裝與 #64 語意守門。
        const args = call.args;
        const amount = Number(args.amount);
        if (isNaN(amount) || amount <= 0) {
            throw new Error('AI 未能提取有效的記帳金額');
        }
        if (!call.valid) {
            throw new Error('AI 輸出的記帳內容無效: ' + call.issues.join('; '));
        }
        let result = {
            amount: amount,
            category: args.category || '其他',
            account: args.account || '現金',
            description: args.description || '',
            type: args.type === 'income' ? 'income' : 'expense',
            date: args.date || undefined
        };
        if (rawText) {
            result = this.applySemanticGuardrail(result, rawText);
            result = this.applyLiteralCategoryGuardrail(result, rawText, categories);
        }
        return result;
    }

    /**
     * 離線規則推論回覆，用於在模型加載前的測試、降級與離線展示
     * #AI-RULES：修復金額誤擷取／備註咬字／協定注入／帳戶預設四項缺陷。
     * @private
     */
    _ruleInference(text, categories, accounts, currentDate = new Date()) {
        const sanitizedInput = stripProtocolTags(text);
        const extractedAmount = extractAmountFromText(sanitizedInput);
        // 找不到有效金額時輸出 0，由 extractToolCall 明確拋錯，不再憑空捏造 100 元
        const amount = extractedAmount !== null ? extractedAmount : 0;

        const catObjs = (Array.isArray(categories) ? categories : [])
            .map(c =>
                typeof c === 'string'
                    ? { name: c.trim() }
                    : c && typeof c.name === 'string'
                      ? { ...c, name: c.name.trim() }
                      : null
            )
            .filter(c => c && c.name);
        const accObjs = (Array.isArray(accounts) ? accounts : [])
            .map(a =>
                typeof a === 'string'
                    ? { name: a.trim() }
                    : a && typeof a.name === 'string'
                      ? { ...a, name: a.name.trim() }
                      : null
            )
            .filter(a => a && a.name);

        const isIncome =
            /(?:領了?|領到|领了?|领到|賺了?|賺到|赚了?|赚到|收入|薪水|工資|工资|發薪|发薪|領薪|领薪|入帳|入账|進帳|进账|獎金|奖金|退款|利息)/.test(
                sanitizedInput
            );
        const type = isIncome ? 'income' : 'expense';

        // 分類匹配：先以最長字面命中，次以語意同義詞模糊匹配，最後才退回清單首項
        const literalCat = findLiteralCategoryName(sanitizedInput, catObjs);
        const fuzzyCat = !literalCat
            ? fuzzyMatchCategory(sanitizedInput, catObjs)?.name || null
            : null;
        const matchedCategory =
            literalCat || fuzzyCat || catObjs[0]?.name || (isIncome ? '其他' : '飲食');

        // 帳戶匹配（#AI-RULES 帳戶預設缺陷修復）：
        // 1. 最長字面匹配（避免短名稱搶先覆蓋長名稱；純 ASCII 短名帶邊界防誤傷）
        // 2. 語意支付關鍵字（刷卡／信用卡／轉帳／銀行／現金）
        // 3. 未提及任何帳戶時：優先現金類帳戶 → 首個非信用卡帳戶 → '現金'（絕不誤預設為信用卡）
        let matchedAccount = null;
        const sortedAccs = [...accObjs].sort((a, b) => b.name.length - a.name.length);
        const lowerInput = sanitizedInput.toLowerCase();
        for (const a of sortedAccs) {
            const nameLower = a.name.toLowerCase();
            if (isAsciiWordOnly(a.name)) {
                const re = new RegExp(`(?<![a-zA-Z0-9])${escapeRegexChars(nameLower)}(?![a-zA-Z0-9])`, 'i');
                if (re.test(sanitizedInput)) {
                    matchedAccount = a.name;
                    break;
                }
            } else if (lowerInput.includes(nameLower)) {
                matchedAccount = a.name;
                break;
            }
        }
        if (!matchedAccount) {
            if (/(?:信用卡|刷卡|刷了)/i.test(sanitizedInput)) {
                matchedAccount = fuzzyMatchAccount('信用卡', accObjs)?.name || null;
            } else if (/(?:轉帳|转账|匯款|汇款|存入|網銀|网银|銀行|银行)/i.test(sanitizedInput)) {
                matchedAccount = fuzzyMatchAccount('銀行', accObjs)?.name || null;
            } else if (/(?:現金|现金|付現|付现|皮夾|錢包)/i.test(sanitizedInput)) {
                matchedAccount = fuzzyMatchAccount('現金', accObjs)?.name || null;
            }
        }
        if (!matchedAccount) {
            const cashAcc = accObjs.find(
                a => a.type === 'cash' || /(?:現金|现金|皮夾|錢包)/.test(a.name)
            );
            const nonCreditAcc = accObjs.find(
                a => a.type !== 'credit_card' && !/(?:信用卡|卡$)/.test(a.name)
            );
            matchedAccount = cashAcc?.name || nonCreditAcc?.name || '現金';
        }

        const d = new Date(currentDate.getTime());
        if (sanitizedInput.includes('大前天')) {
            d.setDate(d.getDate() - 3);
        } else if (sanitizedInput.includes('前天')) {
            d.setDate(d.getDate() - 2);
        } else if (sanitizedInput.includes('昨天')) {
            d.setDate(d.getDate() - 1);
        } else if (sanitizedInput.includes('明天')) {
            d.setDate(d.getDate() + 1);
        }
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        const dateStr = `${year}-${month}-${day}`;

        const description = cleanRuleDescription(sanitizedInput, {
            category: matchedCategory,
            account: matchedAccount,
            isIncome,
        });

        // #AI-RULES 協定注入防禦：對所有寫入壓縮協定的欄位剝除 [TAG] 與 <tool_call> 控制字元
        const safeCat = sanitizeCompressedProtocolField(matchedCategory) || '其他';
        const safeAcc = sanitizeCompressedProtocolField(matchedAccount) || '現金';
        const safeDesc = sanitizeCompressedProtocolField(description) || (isIncome ? '收入' : '消費');

        return `<tool_call>[AMT]${amount}[CAT]${safeCat}[ACC]${safeAcc}[DESC]${safeDesc}[DATE]${dateStr}[TYPE]${type}</tool_call>`;
    }
}

// ==================== #AI-RULES 離線規則降級純函數 ====================

function escapeRegexChars(str) {
    return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isAsciiWordOnly(str) {
    return typeof str === 'string' && str.length > 0 && /^[a-zA-Z0-9\s._-]+$/.test(str);
}

/**
 * 剝除可能干擾壓縮協議解析的標籤與控制字元（#AI-RULES 協定注入防禦）
 */
function stripProtocolTags(text) {
    if (typeof text !== 'string') return '';
    return text
        .replace(/<\/?(?:tool_call|think|thinking)\b[^>]*>/gi, ' ')
        .replace(/<\|[^|]*\|>/g, ' ')
        .replace(/\[(?:AMT|CAT|ACC|DESC|DATE|TYPE)\][^\s[<]*/gi, ' ');
}

function sanitizeCompressedProtocolField(value) {
    if (typeof value !== 'string') return '';
    return stripProtocolTags(value)
        .replace(/[[\]<>\r\n]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * 將全形數字（０-９）、全形金額小數點（．）、全形千分位逗號（，）與全形貨幣符號（＄）正規化為半形（#AI-RULES）。
 * 僅轉換夾在數字之間的小數點與三位數千分位逗號，不破壞中文標點（例如「午餐，200元」）。
 * @param {string} text
 * @returns {string}
 */
export function normalizeFullWidthDigits(text) {
    if (typeof text !== 'string') return '';
    let result = text
        .replace(/[０-９]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
        .replace(/＄/g, '$');
    // 全形小數點：僅限數字之間（例 １２．５ → 12.5）
    result = result.replace(/(\d)．(\d)/g, '$1.$2');
    // 全形千分位逗號：僅限數字與三位數字之間（例 １，２００ → 1,200）
    let prev;
    do {
        prev = result;
        result = result.replace(/(\d)，(\d{3})(?!\d)/g, '$1,$2');
    } while (result !== prev);
    return result;
}

/**
 * 判斷單一字元是否為 CJK 漢字（含基本區、擴展 A 區與相容表意文字，#AI-RULES）。
 * @param {string} ch
 * @returns {boolean}
 */
export function isCjkChar(ch) {
    if (typeof ch !== 'string' || ch.length === 0) return false;
    const code = ch.charCodeAt(0);
    return (
        (code >= 0x4e00 && code <= 0x9fff) ||
        (code >= 0x3400 && code <= 0x4dbf) ||
        (code >= 0xf900 && code <= 0xfaff)
    );
}

const AMOUNT_UNIT_MULTIPLIERS = {
    萬: 10000,
    万: 10000,
    千: 1000,
    k: 1000,
    K: 1000,
    百: 100,
};

function parseAmountCandidate(numStr, unit) {
    if (!numStr) return null;
    const base = parseFloat(String(numStr).replace(/,/g, ''));
    if (!Number.isFinite(base) || base <= 0) return null;
    const mult = unit ? AMOUNT_UNIT_MULTIPLIERS[unit] || 1 : 1;
    const val = Math.round(base * mult * 100) / 100;
    return Number.isFinite(val) && val > 0 ? val : null;
}

/**
 * 從自然語言記帳文字中精準擷取金額（#AI-RULES 金額誤擷取修復）：
 * - 支援全形數字（１５０）、千分位逗號（12,000）、小數（85.5）、單位倍率（2萬／1.5k／3千／5百）與貨幣前綴（NT$／$）
 * - 自動遮罩日期（2026-08-03、8月3日、8/3）、時間（12:30、3點）、序數期別（第3期）、店名數字（7-11、85度C、50嵐）、百分比與量詞（2杯、3個、1000ml）
 * - 無有效正金額時回傳 null（絕不捏造 100 元）
 * @param {string} text
 * @returns {number|null}
 */
export function extractAmountFromText(text) {
    if (typeof text !== 'string' || !text.trim()) return null;

    // 先移除協定注入標籤後轉半形數字
    let masked = normalizeFullWidthDigits(stripProtocolTags(text));

    // 1. 遮罩非金額的數字語境（以空白取代維持分詞邊界）
    const nonAmountPatterns = [
        // 完整日期：2026-08-03 / 2026/8/3 / 2026.08.03
        /(?<!\d)\d{4}[-/.]\d{1,2}(?:[-/.]\d{1,2})?(?!\d)/g,
        // 中文日期：2026年8月3日 / 8月3日 / 8月 / 3日 / 3號
        /\d{4}\s*年(?:\s*\d{1,2}\s*月)?(?:\s*\d{1,2}\s*[日號号])?/g,
        /(?<!\d)\d{1,2}\s*月(?:\s*\d{1,2}\s*[日號号])?/g,
        /(?<!\d)\d{1,2}\s*[日號号]/g,
        // 短日期：8/3、12/25
        /(?<!\d)(?:0?[1-9]|1[0-2])\/(?:0?[1-9]|[12]\d|3[01])(?!\d)/g,
        // 時間：12:30 / 12:30:00 / 3點半 / 3點20分
        /(?<!\d)\d{1,2}:\d{2}(?::\d{2})?(?!\d)/g,
        /(?<!\d)\d{1,2}\s*(?:點|点|時|时)(?:\s*\d{1,2}\s*分|半)?/g,
        // 期數／序數：第3期 / 第2次
        /第\s*\d+\s*[期次天月年回屆]/g,
        // 常見含數字店名／品牌
        /\b7\s*-\s*(?:11|eleven)\b/gi,
        /85\s*度\s*c/gi,
        /50\s*嵐/g,
        // 折扣／百分比：9折 / 85折 / 10%
        /(?<![\d.,])\d+(?:\.\d+)?\s*(?:%|％|折)/g,
        // 數量＋非貨幣量詞（後接元／塊等貨幣字則保留）
        /(?<![\d.,])\d+(?:\.\d+)?\s*(?:個|个|杯|碗|盤|盘|份|瓶|罐|包|盒|袋|箱|件|雙|双|支|隻|只|條|条|張|张|本|台|臺|顆|颗|粒|片|次|趟|人|位|天|週|周|小時|小时|分鐘|分钟|公里|公尺|公分|公斤|公克|克|毫升|ml|kg|km|度)(?![a-zA-Z])(?!\s*(?:元|塊|块|圓|圆|萬|万|千|百|[kK]))/gi,
    ];
    for (const pat of nonAmountPatterns) {
        masked = masked.replace(pat, ' ');
    }

    const NUM = '((?:\\d{1,3}(?:,\\d{3})+|\\d+)(?:\\.\\d+)?)';

    // Priority 1a：貨幣前綴（NT$380、$150、¥2000）
    const prefixRe = new RegExp(`(?:NT\\$|US\\$|\\$|￥|¥)\\s*${NUM}\\s*(萬|万|千|百|[kK](?![a-zA-Z]))?`, 'i');
    const prefixMatch = masked.match(prefixRe);
    if (prefixMatch) {
        const val = parseAmountCandidate(prefixMatch[1], prefixMatch[2]);
        if (val !== null) return val;
    }

    // Priority 1b：明確單位倍率或貨幣後綴（250元、1.5萬、2k、3千塊）
    const suffixRe = new RegExp(
        `${NUM}\\s*(?:(萬|万|千|百|[kK](?![a-zA-Z]))\\s*(?:元|塊|块|圓|圆|台幣|臺幣)?|(?:元|塊|块|圓|圆|台幣|臺幣|NTD|TWD|USD|JPY|EUR)(?![a-zA-Z]))`,
        'i'
    );
    const suffixMatch = masked.match(suffixRe);
    if (suffixMatch) {
        const val = parseAmountCandidate(suffixMatch[1], suffixMatch[2]);
        if (val !== null) return val;
    }

    // Priority 1c：消費／收入動詞緊接數字（花了250、領到5000）
    const verbRe = new RegExp(
        `(?:花了?|花費|花费|付了?|支付|刷了?|共|總共|总共|合計|合计|金額|金额|收入|賺了?|赚了?|領了?|领了?|領到|领到)\\s*${NUM}\\s*(萬|万|千|百|[kK](?![a-zA-Z]))?`,
        'i'
    );
    const verbMatch = masked.match(verbRe);
    if (verbMatch) {
        const val = parseAmountCandidate(verbMatch[1], verbMatch[2]);
        if (val !== null) return val;
    }

    // Priority 2：其餘獨立數字（中文記帳句式金額多在句尾，取最後一個有效正數）
    const bareRe = new RegExp(`(?<![a-zA-Z\\d.,])${NUM}(?![a-zA-Z\\d.])`, 'g');
    let lastVal = null;
    let m;
    while ((m = bareRe.exec(masked)) !== null) {
        const val = parseAmountCandidate(m[1], null);
        if (val !== null) lastVal = val;
    }
    return lastVal;
}

/**
 * 清理離線規則推論的備註文字（#AI-RULES 備註咬字修復）：
 * - 以多字詞交替群組取代舊版字元集 `[...]`，絕不誤刪「早餐」「大杯」「牙刷」「元氣」「天婦羅」「花束」「上海」中的字元
 * - 保留常見品牌數字（7-11、85度C、50嵐），僅移除金額片語、時間副詞、帳戶與控制標籤
 * - 透過 isCjkChar() 折疊漢字間多餘空白同時保留英文單字間距
 * @param {string} rawText
 * @param {object|string} [optionsOrCategory]
 * @param {string} [matchedAccount]
 * @param {boolean} [isIncome]
 * @returns {string}
 */
export function cleanRuleDescription(
    rawText,
    optionsOrCategory = {},
    matchedAccount = '',
    isIncome = false
) {
    let category = '';
    let account = matchedAccount || '';
    let incomeFlag = Boolean(isIncome);
    if (optionsOrCategory && typeof optionsOrCategory === 'object') {
        category = optionsOrCategory.category || '';
        account = optionsOrCategory.account || '';
        incomeFlag = Boolean(optionsOrCategory.isIncome);
    } else if (typeof optionsOrCategory === 'string') {
        category = optionsOrCategory;
    }

    if (typeof rawText !== 'string' || !rawText.trim()) {
        return incomeFlag ? '收入' : '消費';
    }

    // 先剝除協定標籤與控制字元
    let desc = stripProtocolTags(rawText).replace(/[[\]<>\r\n]/g, ' ');
    desc = normalizeFullWidthDigits(desc);

    // 暫時保護含數字的品牌名稱，避免被金額剝除規則誤傷（佔位符使用純英文字母避免被數字規則觸及）
    const protectedTokens = [];
    const protect = regex => {
        desc = desc.replace(regex, match => {
            const idx = protectedTokens.push(match) - 1;
            const tag = String.fromCharCode(65 + (idx % 26)).repeat(Math.floor(idx / 26) + 1);
            return `ZXQBRAND${tag}ZXQ`;
        });
    };
    protect(/\b7\s*-\s*(?:11|eleven)\b/gi);
    protect(/85\s*度\s*c/gi);
    protect(/50\s*嵐/g);

    const literalCatInText = Boolean(category && category.length >= 2 && desc.includes(category));

    // 移除帳戶片語（搭配常見介系詞，且對純 ASCII 帳戶名做詞邊界防護）
    if (account) {
        const escAcc = escapeRegexChars(account);
        const accPattern = isAsciiWordOnly(account)
            ? new RegExp(`(?:用|刷|從|从|以|存入|轉入|转入|匯入|汇入)?\\s*(?<![a-zA-Z0-9])${escAcc}(?![a-zA-Z0-9])`, 'gi')
            : new RegExp(`(?:用|刷|從|从|以|存入|轉入|转入|匯入|汇入)?\\s*${escAcc}`, 'g');
        desc = desc.replace(accPattern, ' ');
    }

    // 移除字面出現的分類名（稍後若殘句清空再回填分類名）
    if (literalCatInText) {
        const escCat = escapeRegexChars(category);
        const catPattern = isAsciiWordOnly(category)
            ? new RegExp(`(?<![a-zA-Z0-9])${escCat}(?![a-zA-Z0-9])`, 'gi')
            : new RegExp(escCat, 'g');
        desc = desc.replace(catPattern, ' ');
    }

    // 移除相對日期與時段詞（多字精確詞組，不咬「早餐／午餐／晚餐／大杯／天婦羅／上海」）
    desc = desc.replace(
        /(?:大前天|前天|昨天|今天|明天|後天|后天|早上|上午|中午|下午|傍晚|晚上|深夜|凌晨|剛剛|剛才|刚才)/g,
        ' '
    );
    // 移除明確日期／時間字串
    desc = desc
        .replace(/(?<!\d)\d{4}[-/.]\d{1,2}(?:[-/.]\d{1,2})?(?!\d)/g, ' ')
        .replace(/(?<!\d)\d{1,2}:\d{2}(?::\d{2})?(?!\d)/g, ' ');

    // 移除金額片語（連同緊鄰的消費/收入動詞、貨幣符號與單位，不單獨砍「元／塊／花／刷」，亦保留量詞如「2杯」「3個」）
    // 單字動詞（花/付/刷/共/賺/領）僅於非漢字字元後方生效，避免誤咬「買牙刷 99元」「買豆花 50元」中的名詞尾字
    const VERB_OPT = '(?:花了|花費|花费|付了|支付|刷了|總共|总共|合計|合计|賺了|赚了|領了|领了|領到|领到|(?<![\\u4e00-\\u9fff])(?:花|付|刷|共|賺|赚|領|领))?';
    const NUM_CORE = '(?:\\d{1,3}(?:,\\d{3})+|\\d+)(?:\\.\\d+)?';
    const UNIT_CORE = '(?:(?:萬|万|千|百|[kK](?![a-zA-Z]))\\s*(?:元|塊|块|圓|圆|台幣|臺幣)?|(?:元|塊|块|圓|圆|台幣|臺幣|NTD|TWD|USD|JPY|EUR)(?![a-zA-Z]))';
    const NON_MONEY_LOOKAHEAD = '(?!\\s*(?:個|个|杯|碗|盤|盘|份|瓶|罐|包|盒|袋|箱|件|雙|双|支|隻|只|條|条|張|张|本|台|臺|顆|颗|粒|片|次|趟|人|位|天|週|周|月|年|日|號|号|點|点|時|时|分|小時|小时|分鐘|分钟|公里|公尺|公分|公斤|公克|克|毫升|ml|kg|km|度|%|％|折|期|回|屆))';
    desc = desc
        .replace(new RegExp(`${VERB_OPT}\\s*(?:NT\\$|US\\$|\\$|￥|¥)\\s*${NUM_CORE}(?:\\s*${UNIT_CORE})?`, 'gi'), ' ')
        .replace(new RegExp(`${VERB_OPT}\\s*${NUM_CORE}\\s*${UNIT_CORE}`, 'gi'), ' ')
        .replace(new RegExp(`${VERB_OPT}\\s*(?<![a-zA-Z\\d.,])${NUM_CORE}(?![a-zA-Z\\d.])${NON_MONEY_LOOKAHEAD}`, 'gi'), ' ');

    // 還原品牌名稱
    desc = desc.replace(/ZXQBRAND([A-Z]+)ZXQ/g, (_, tag) => {
        const idx = (tag.length - 1) * 26 + (tag.charCodeAt(0) - 65);
        return protectedTokens[idx] || '';
    });

    // 清理首尾殘留連接詞與標點（僅剝除完整動詞片語，絕不單獨咬掉「花束」「牙刷」「付費」中的單字）
    desc = desc
        .replace(/^(?:花了|花費|花费|付了|刷了|用|在|存入|轉入|转入|領了|领了|領到|领到|賺了|赚了|[，。、：:；;,\s])+/g, '')
        .replace(/(?:花了|花費|花费|付了|刷了|用|存入|轉入|转入|[，。、：:；;,\s])+$/g, '')
        .replace(/\s+/g, ' ')
        .trim();

    // 折疊兩個相鄰 CJK 字元中間因抽字留下的單一空白（保留英文單字間距）
    let collapsed = '';
    for (let i = 0; i < desc.length; i++) {
        const ch = desc[i];
        if (
            ch === ' ' &&
            i > 0 &&
            i < desc.length - 1 &&
            isCjkChar(desc[i - 1]) &&
            isCjkChar(desc[i + 1])
        ) {
            continue;
        }
        collapsed += ch;
    }

    const finalDesc = collapsed.trim();
    if (!finalDesc) {
        return literalCatInText ? category : incomeFlag ? '收入' : '消費';
    }
    return finalDesc;
}

/**
 * 智慧模糊匹配帳戶 (支援大小寫/空白忽略、雙向包含、語意別名與編輯距離容錯)
 * @param {string} predicted - AI 模型解析出的帳戶名稱 (如 "信用卡", "Line Pay", "國泰", "Richart")
 * @param {Array<object>} accounts - 現有帳戶物件清單 (每個帳戶含 id, name, type 等)
 * @returns {object|null} - 匹配到的帳戶物件或 null
 */
export function fuzzyMatchAccount(predicted, accounts) {
    if (!predicted || !Array.isArray(accounts) || accounts.length === 0) return null;
    const cleanPredicted = String(predicted).trim();
    if (!cleanPredicted) return null;

    // 1. 完全精確匹配
    const exact = accounts.find(a => a.name === cleanPredicted);
    if (exact) return exact;

    // 正規化函式：去除空白、符號、轉小寫
    const norm = s => String(s || '').toLowerCase().replace(/[\s\-_/\\()（）「」【】]/g, '');
    const normPred = norm(cleanPredicted);
    if (!normPred) return null;

    // 2. 正規化後完全相等 (解決大小寫、空格差異，如 "LINE Pay" vs "linepay")
    const normExact = accounts.find(a => norm(a.name) === normPred);
    if (normExact) return normExact;

    // 3. 雙向子字串包含匹配 (長度 >= 2)
    // 3a. 帳戶名稱包含預測名稱 (如 帳戶 "中國信託 LINE Pay 信用卡" 包含 "LINE Pay", 帳戶 "國泰世華銀行" 包含 "國泰")
    const accountsContainingPred = accounts.filter(a => {
        const na = norm(a.name);
        return na.length >= 2 && normPred.length >= 2 && na.includes(normPred);
    });
    if (accountsContainingPred.length === 1) {
        return accountsContainingPred[0];
    } else if (accountsContainingPred.length > 1) {
        // 多個命中時，優先取長度最接近（重合比例最高）者
        return accountsContainingPred.sort((a, b) => norm(a.name).length - norm(b.name).length)[0];
    }

    // 3b. 預測名稱包含帳戶名稱 (如 預測 "玉山銀行存款" 包含 帳戶 "玉山銀行")
    const accountsContainedInPred = accounts.filter(a => {
        const na = norm(a.name);
        return na.length >= 2 && normPred.includes(na);
    });
    if (accountsContainedInPred.length > 0) {
        // 取帳戶名稱最長者（例如 "玉山銀行" 優於 "玉山"）
        return accountsContainedInPred.sort((a, b) => norm(b.name).length - norm(a.name).length)[0];
    }

    // 4. 語意別名與帳戶類型匹配 (Semantic Type Aliases)
    const isCreditCardKeyword = /(?:信用卡|刷卡|卡片|credit|card)/i.test(cleanPredicted);
    if (isCreditCardKeyword) {
        // 先找 type === 'credit_card' 或名稱含「卡」/「信用卡」的帳戶
        const cardAccounts = accounts.filter(a => a.type === 'credit_card' || /信用卡|卡/.test(a.name));
        if (cardAccounts.length === 1) {
            return cardAccounts[0];
        } else if (cardAccounts.length > 1) {
            // 若有多張卡，檢查 predicted 中是否包含特定的銀行或卡名關鍵字
            for (const card of cardAccounts) {
                const cleanCardName = norm(card.name).replace(/信用卡|卡/g, '');
                if (cleanCardName.length >= 2 && normPred.includes(cleanCardName)) {
                    return card;
                }
            }
            return cardAccounts[0]; // 預設使用第一張信用卡
        }
    }

    const isCashKeyword = /(?:現金|皮夾|錢包|零錢|鈔票|cash)/i.test(cleanPredicted);
    if (isCashKeyword) {
        const cashAcc = accounts.find(a => a.type === 'cash' || /現金|皮夾|錢包|零錢/.test(a.name));
        if (cashAcc) return cashAcc;
    }

    const isBankKeyword = /(?:轉帳|匯款|銀行|網銀|活存|存款|bank)/i.test(cleanPredicted);
    if (isBankKeyword) {
        const bankAccounts = accounts.filter(a => a.type === 'bank' || /銀行|郵局|存款|活存/.test(a.name));
        if (bankAccounts.length === 1) {
            return bankAccounts[0];
        } else if (bankAccounts.length > 1) {
            for (const b of bankAccounts) {
                const cleanBankName = norm(b.name).replace(/銀行|帳戶|存款|活存/g, '');
                if (cleanBankName.length >= 2 && normPred.includes(cleanBankName)) {
                    return b;
                }
            }
            return bankAccounts[0];
        }
    }

    // 5. 編輯距離 Levenshtein <= 1 容錯
    const levDist = (a, b) => {
        if (a === b) return 0;
        if (!a) return b.length;
        if (!b) return a.length;
        let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
        for (let i = 1; i <= a.length; i++) {
            const curr = [i];
            for (let j = 1; j <= b.length; j++) {
                curr.push(Math.min(
                    prev[j] + 1,
                    curr[j - 1] + 1,
                    prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
                ));
            }
            prev = curr;
        }
        return prev[b.length];
    };

    let bestAcc = null;
    let bestDist = 2;
    for (const a of accounts) {
        const d = levDist(normPred, norm(a.name));
        if (d < bestDist) {
            bestDist = d;
            bestAcc = a;
        }
    }
    if (bestDist <= 1) return bestAcc;

    return null;
}

/**
 * 不參與字面命中的內建兜底分類名：「其他」在自由文字中極常以連接詞身分出現
 * （例「買東西和其他雜支300」），字面命中會誤把整筆蓋成其他；且該名稱本就在
 * 訓練 enum 池（11525 次），模型本可正確處理，守門介入沒有增益。
 */
const LITERAL_GUARDRAIL_BLOCKLIST = new Set(['其他', '其它']);

/**
 * 找出原始輸入中「字面出現的最長分類名」（使用者把類別名直接打成輸入的情境）。
 * 例：類別有「孝親費」，輸入「孝親費10000給媽」→ 回傳 '孝親費'。
 * @param {string} text - 原始使用者輸入
 * @param {Array<string|object>} categories - 分類清單（字串或含 name 的物件）
 * @returns {string|null}
 */
export function findLiteralCategoryName(text, categories) {
    if (!text || typeof text !== 'string') return null;
    if (!Array.isArray(categories) || categories.length === 0) return null;

    const names = [];
    for (const c of categories) {
        const name = typeof c === 'string' ? c : (c && typeof c.name === 'string' ? c.name : '');
        const trimmed = (name || '').trim();
        if (trimmed.length < 2 || LITERAL_GUARDRAIL_BLOCKLIST.has(trimmed)) continue;
        if (text.includes(trimmed)) names.push(trimmed);
    }
    if (names.length === 0) return null;

    // 最長優先：「股票股利」勝過「股票」
    names.sort((a, b) => b.length - a.length);
    return names[0];
}

/**
 * 智慧模糊匹配分類 (支援大小寫/空白忽略、雙向包含、同義詞映射與編輯距離容錯)
 * @param {string} predicted - AI 模型解析出的分類名稱
 * @param {Array<object>} categories - 分類物件清單 (每個物件含 id, name 等)
 * @returns {object|null}
 */
export function fuzzyMatchCategory(predicted, categories) {
    if (!predicted || !Array.isArray(categories) || categories.length === 0) return null;
    const cleanPredicted = String(predicted).trim();
    if (!cleanPredicted) return null;

    // 1. 完全精確匹配
    const exact = categories.find(c => c.name === cleanPredicted);
    if (exact) return exact;

    const norm = s => String(s || '').toLowerCase().replace(/[\s\-_/\\()（）「」【】]/g, '');
    const normPred = norm(cleanPredicted);
    if (!normPred) return null;

    // 2. 正規化後完全相等
    const normExact = categories.find(c => norm(c.name) === normPred);
    if (normExact) return normExact;

    // 3. 雙向子字串包含 (長度 >= 2)
    const containing = categories.filter(c => {
        const nc = norm(c.name);
        return nc.length >= 2 && normPred.length >= 2 && (nc.includes(normPred) || normPred.includes(nc));
    });
    if (containing.length === 1) {
        return containing[0];
    } else if (containing.length > 1) {
        return containing.sort((a, b) => Math.abs(norm(a.name).length - normPred.length) - Math.abs(norm(b.name).length - normPred.length))[0];
    }

    // 4. 常見生活領域同義詞映射
    const categorySynonyms = [
        { regex: /(?:餐飲|飲食|早午餐|早餐|午餐|晚餐|便當|火鍋|飲料|咖啡|手搖|下午茶|小吃|食品|吃飯)/, target: /(?:飲食|餐飲|食物|食品)/ },
        { regex: /(?:交通|通勤|搭車|車資|公車|捷運|高鐵|火車|計程車|uber|加油|油錢|停車|過路費)/, target: /(?:交通|車資|通勤)/ },
        { regex: /(?:日常|日用|生活|生活用品|家用品|雜物|雜支|超商|超市|賣場)/, target: /(?:日常|生活|雜支)/ },
        { regex: /(?:娛樂|玩樂|休閒|電影|遊戲|看展|演唱會|旅遊|度假)/, target: /(?:娛樂|休閒|玩樂)/ },
        { regex: /(?:醫療|看病|診所|醫院|掛號|藥品|藥局|感冒|牙醫)/, target: /(?:醫療|保健|健康)/ },
        { regex: /(?:薪水|薪資|工資|月薪|發薪|領薪)/, target: /(?:薪水|薪資|工資)/ },
        { regex: /(?:獎金|紅利|年終|分紅|外快|績效)/, target: /(?:獎金|紅利)/ },
        { regex: /(?:投資|股票|基金|股利|利息|理財)/, target: /(?:投資|理財|利息)/ }
    ];

    for (const syn of categorySynonyms) {
        if (syn.regex.test(cleanPredicted)) {
            const matched = categories.find(c => syn.target.test(c.name));
            if (matched) return matched;
        }
    }

    // 5. 編輯距離 Levenshtein <= 1 容錯
    const levDist = (a, b) => {
        if (a === b) return 0;
        if (!a) return b.length;
        if (!b) return a.length;
        let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
        for (let i = 1; i <= a.length; i++) {
            const curr = [i];
            for (let j = 1; j <= b.length; j++) {
                curr.push(Math.min(
                    prev[j] + 1,
                    curr[j - 1] + 1,
                    prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
                ));
            }
            prev = curr;
        }
        return prev[b.length];
    };

    let bestCat = null;
    let bestDist = 2;
    for (const c of categories) {
        const d = levDist(normPred, norm(c.name));
        if (d < bestDist) {
            bestDist = d;
            bestCat = c;
        }
    }
    if (bestDist <= 1) return bestCat;

    return null;
}
