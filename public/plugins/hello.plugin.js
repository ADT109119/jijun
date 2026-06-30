export default {
    meta: {
        id: 'com.example.hello',
        name: 'Hello World Plugin',
        version: '1.1',
        description: '這是一個範例插件，安裝後會顯示歡迎訊息。',
        author: 'The walking fish 步行魚',
        permissions: [
            'ui'
        ]
    },
    init(context) {
        console.log('Hello World Plugin Initialized!');
        // 使用 APP 提供的 UI API 顯示 Toast
        context.ui.showToast('👋 Hello! 插件系統運作正常！', 'success');
        
        // 範例：也可以存取 context.appName 或 context.version
        console.log(`Plugin running on ${context.appName} v${context.version}`);
    }
};
