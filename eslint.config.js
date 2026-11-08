// ESLint flat config（ESLint 10 起不再支援 .eslintrc.* 舊格式，#70 依賴升級後本檔接管）
// 本檔為舊 .eslintrc.json 的忠實遷移版：
//   - env: browser/serviceworker/jest/node 以 globals 套件等价合併提供（舊版 env 為全域生效，故主區塊同時含 browser+node）
//   - extends eslint:recommended 對齊 ESLint 8 時代的推薦規則集：
//     新規則 no-useless-assignment(ESLint 9)/preserve-caught-error(ESLint 9) 非舊行為，降為 warn/off 維持零錯誤基線，
//     後續可作為程式碼品質改進单独排程（避免工具遷移摻入大量 src 行為面改動）
//   - rules/globals 一一對應舊檔
import js from '@eslint/js';
import globals from 'globals';

// 原本 .eslintrc.json 的 globals 區塊（Vite define 注入點 + 第三方 SDK + 測試框架）
const projectGlobals = {
    __APP_VERSION__: 'readonly',
    googletag: 'readonly',
    TimestampTrigger: 'readonly',
    QRCode: 'readonly',
    Html5Qrcode: 'readonly',
    __AD_ADSENSE_CLIENT_ID__: 'readonly',
    __AD_ENABLED__: 'readonly',
    __ACCESS_CODE__: 'readonly',
    __AD_ADSENSE_AD_SLOT__: 'readonly',
    __AD_GPT_REWARDED_PATH__: 'readonly',
    __AD_ADMOB_BANNER_ID__: 'readonly',
    __AD_ADMOB_REWARDED_ID__: 'readonly',
    __AD_IS_TESTING__: 'readonly',
    __WEB_STORE_URL__: 'readonly',
    gapi: 'readonly',
    google: 'readonly',
    // 舊 env.jest 殘留：本專案實際用 Vitest（vite.config.js test.globals = true 注入）
    vi: 'readonly',
    describe: 'readonly',
    it: 'readonly',
    test: 'readonly',
    expect: 'readonly',
    beforeEach: 'readonly',
    afterEach: 'readonly',
    beforeAll: 'readonly',
    afterAll: 'readonly',
    // 舊 env.node 全域生效；src/js/utils.js 以 typeof process 守門做測試環境偵測（瀏覽器端不存在）
    process: 'readonly'
};

export default [
    // 構成品與第三方 vendored 程式碼：不進 lint
    // （vendor 為上游打包產物，其 no-var/eqeqeq 屬上游風格，不適用本專案規則）
    {
        ignores: [
            'dist/**',
            'node_modules/**',
            'coverage/**',
            '.worktrees/**',
            'tools/**', // git submodule（AI 訓練工具，獨立專案）
            'src/vendor/**', // qrcode.js / wllama 上游打包產物
            'android/app/build/**',
            'android/app/src/main/assets/public/**', // capacitor sync 產物
            'android/**', // 原生專案由 Android 工具鏈管理
            '*.min.js'
        ]
    },
    js.configs.recommended,
    {
        // 全專案共用規則（對應舊 .eslintrc.json rules 區塊）
        // 專案為 ES Modules（package.json type=module + Vite import）
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'module',
            globals: {
                ...globals.browser,
                ...globals.node,
                ...projectGlobals
            }
        },
        rules: {
            // ESLint 8 升級忠實遷移：ignoreRestSiblings:true 恢復 ESLint 8 預設（豁免
            // `const { id, ...rest }` 剔除式解構慣用法，ESLint 9 起預設改 false 造成誤報潮）；
            // args 維持預設 after-used；^_ 底線前綴=刻意未用（專案慣例 _url/_rid/_key，
            // 9/22 改名時即為此意圖，補上 pattern 才生效）
            'no-unused-vars': ['warn', {
                caughtErrors: 'none',
                ignoreRestSiblings: true,
                args: 'after-used',
                argsIgnorePattern: '^_',
                varsIgnorePattern: '^_'
            }],
            'no-console': 'off',
            'prefer-const': 'error',
            'no-var': 'error',
            'no-dupe-keys': 'error',
            'no-duplicate-case': 'error',
            'no-fallthrough': 'error',
            // eqeqeq：容忍 `!= null` / `== null` 慣用法（同時涵蓋 null+undefined，
            // 專案內 dataService/addPage/toolsSchema/server 均以此做空值防呆，改 === 會縮小語意）
            'eqeqeq': ['error', 'always', { null: 'ignore' }],
            // 專案慣用 fire-and-forget 寫法 `catch (_) {}`（全專案 17+ 處），容忍空 catch；
            // 其餘空區塊（if/for/try）仍照樣報錯
            'no-empty': ['error', { allowEmptyCatch: true }],
            // === 非舊版行為的新推薦規則，維持遷移前零錯誤基線 ===
            'no-useless-assignment': 'warn', // ESLint 9 新增 → warn：提示不阻斷，品質改善另行排程
            'preserve-caught-error': 'off' // ESLint 9 新增 → off：syncService 8 處 throw 未帶 cause，屬改進項非遷移回歸
        }
    },
    {
        // Service Worker：用自己的 SW global scope 環境（覆蓋主區塊的 window/document 假設）
        files: ['public/serviceWorker.js'],
        languageOptions: {
            globals: { ...globals.serviceworker, ...projectGlobals }
        }
    }
];
