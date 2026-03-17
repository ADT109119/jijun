import fs from 'fs';

const p = 'public/plugins/index.json';
const data = JSON.parse(fs.readFileSync(p, 'utf8'));

// 檢查是否已經存在
if (!data.some(d => d.id === 'com.walkingfish.e_invoice')) {
    data.push({
        "id": "com.walkingfish.e_invoice",
        "name": "電子發票掃描",
        "description": "開啟相機掃描電子發票 QR Code，自動帶入金額與號碼，並提供自動對獎功能。也提供專屬發票清單頁面。",
        "version": "1.0",
        "author": "The walking fish 步行魚",
        "file": "plugins/e_invoice.plugin.js",
        "icon": "fa-qrcode",
        "permissions": ["camera", "storage", "data:write", "ui", "network"]
    });
    fs.writeFileSync(p, JSON.stringify(data, null, 2));
}

// 修改發票 plugin 增加 widget
let pluginContent = fs.readFileSync('public/plugins/e_invoice.plugin.js', 'utf8');
if (!pluginContent.includes('registerHomeWidget')) {
    pluginContent = pluginContent.replace(
        "this.registerInvoiceListPage();",
        "this.registerInvoiceListPage();\n        this.registerWidget();"
    );

    const widgetCode = `
    registerWidget() {
        this.context.ui.registerHomeWidget('e_invoice_widget', async (container) => {
            container.innerHTML = \`
                <div class="bg-white rounded-2xl p-4 shadow-sm border border-gray-100 flex items-center justify-between cursor-pointer hover:bg-gray-50 transition-colors" onclick="window.location.hash='#invoice_list'">
                    <div class="flex items-center gap-3">
                        <div class="w-10 h-10 rounded-full bg-wabi-primary/10 text-wabi-primary flex items-center justify-center">
                            <i class="fa-solid fa-qrcode text-lg"></i>
                        </div>
                        <div>
                            <div class="font-bold text-gray-800">發票管理</div>
                            <div class="text-xs text-gray-500">點擊查看已掃描的電子發票</div>
                        </div>
                    </div>
                    <i class="fa-solid fa-chevron-right text-gray-300"></i>
                </div>
            \`;
        });
    },
    `;

    pluginContent = pluginContent.replace(
        "registerInvoiceListPage() {",
        widgetCode + "\n    registerInvoiceListPage() {"
    );

    fs.writeFileSync('public/plugins/e_invoice.plugin.js', pluginContent);
}
