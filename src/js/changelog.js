// 版本更新日誌模組
export const CHANGELOG = {
  "2.0.7.2": {
    date: "2024-07-12",
    title: "icon 更新",
    features: [
    ],
    bugfixes: [
    ],
    improvements: [
      "製作新的 icon，完全重新繪製"
    ]
  },
  "2.0.7.1": {
    date: "2024-07-12",
    title: "瀏覽器歷史記錄管理與設定介面修復",
    features: [
      "新增瀏覽器歷史記錄管理功能，支援手機返回鍵在應用內導航，不再直接退出程式",
      "URL 同步顯示當前頁面狀態（#home, #add, #records, #stats）",
      "支援瀏覽器前進/後退按鈕操作"
    ],
    bugfixes: [
      "修復設定介面無法打開的問題",
      "修復頁面切換時事件監聽器失效的問題",
      "解決 PWA 中返回鍵直接退出應用的問題",
      "修復循環設定版本資訊的 bug"
    ],
    improvements: [
      "使用事件委託優化設定按鈕的事件處理",
      "改善 PWA 的使用體驗和導航流暢度"
    ]
  },
  "2.0.7": {
    date: "2024-07-12",
    title: "使用體驗優化與新增更新日誌",
    features: [
      "新增完整的版本更新日誌系統"
    ],
    bugfixes: [
      "修復明細頁面編輯時不會預設選擇原分類的問題",
      "修復首頁 slider 滑動衝突，現在可以正常垂直滾動頁面"
    ],
    improvements: [
    ]
  },
  "2.0.6.3": {
    date: "2024-07-07",
    title: "日期篩選修復與記帳頁面優化",
    bugfixes: [
      "修復日期篩選錯誤顯示上個月月底記錄的問題",
      "修正時間範圍計算的時區轉換問題"
    ],
    improvements: [
      "調整記帳頁面 CSS 樣式",
      "優化輸入區域布局和間距",
      "改善整體視覺效果"
    ]
  },
  "2.0.6.2": {
    date: "2024-07-06",
    title: "記帳小鍵盤介面調整",
    improvements: [
      "微調記帳頁面小鍵盤 CSS 樣式",
      "優化按鈕大小和間距",
      "改善觸控體驗"
    ]
  },
  "2.0.6.1": {
    date: "2024-07-06",
    title: "背景樣式優化",
    improvements: [
      "調整應用程式背景 CSS",
      "改善整體視覺配色方案",
      "優化使用者介面美觀度"
    ]
  },
  "2.0.6": {
    date: "2024-07-06",
    title: "分類管理系統增強",
    features: [
      "添加自訂圖示功能，支援更多個性化選擇",
      "分類名單設定頁面添加滾動功能",
      "避免長列表被裁切的問題"
    ],
    improvements: [
      "優化分類選擇介面",
      "改善分類管理的使用體驗",
      "增強分類設定的靈活性"
    ]
  },
  "2.0.5": {
    date: "2024-07-06",
    title: "記帳功能完善",
    features: [
      "記帳項目支援後續編輯分類功能",
      "增強記錄管理的靈活性"
    ],
    improvements: [
      "調整數字鍵盤大小，提升使用體驗",
      "優化記帳介面布局",
      "改善觸控操作感受"
    ]
  },
  "2.0.4.2": {
    date: "2024-07-06",
    title: "路徑修復",
    bugfixes: [
      "修復部分檔案路徑錯誤",
      "解決資源載入問題"
    ]
  },
  "2.0.4.1": {
    date: "2024-07-06",
    title: "版本號顯示修復",
    bugfixes: [
      "修復版本號顯示錯誤的問題",
      "確保版本資訊正確顯示"
    ]
  },
  "2.0.4": {
    date: "2024-07-06",
    title: "小鍵盤最小化與更新檢查",
    features: [
      "記帳頁面小鍵盤支援最小化功能",
      "添加檢查更新按鈕",
      "支援手動檢查應用程式更新"
    ],
    improvements: [
      "優化記帳頁面空間利用",
      "改善小螢幕使用體驗",
      "增強應用程式更新機制"
    ]
  },
  "2.0.3": {
    date: "2024-07-06",
    title: "Service Worker 版本管理",
    features: [
      "調整 Service Worker 支援版本號偵測",
      "實現強制更新機制",
      "添加版本更新通知功能"
    ],
    improvements: [
      "優化應用程式更新流程",
      "改善快取管理策略",
      "增強離線功能穩定性"
    ]
  },
  "2.0.2": {
    date: "2024-07-06",
    title: "首頁滑動體驗優化",
    features: [
      "首頁 Slider 支援即時滑動跟隨",
      "添加滑動手勢支援",
      "實現流暢的頁面切換效果"
    ],
    improvements: [
      "優化觸控操作體驗",
      "改善頁面切換動畫",
      "增強使用者互動感受"
    ]
  },
  "2.0.1": {
    date: "2024-07-06",
    title: "資料管理功能",
    features: [
      "添加資料上傳頁面",
      "支援資料匯入匯出功能",
      "實現資料備份與還原"
    ],
    improvements: [
      "優化資料處理流程",
      "改善檔案操作介面",
      "增強資料安全性"
    ]
  },
  "2.0.0": {
    date: "2024-07-02",
    title: "全新版本發布",
    features: [
      "全新的現代化介面設計",
      "響應式布局支援各種螢幕尺寸",
      "底部導航系統",
      "首頁統計儀表板",
      "記帳明細列表頁面",
      "統計分析功能"
    ],
    improvements: [
      "使用 Tailwind CSS 重新設計",
      "採用 ES6 模組化開發",
      "優化載入速度和使用體驗"
    ]
  },
  "1.x": {
    date: "2024-06-30",
    title: "舊版本功能",
    features: [
      "基礎記帳功能",
      "簡單的資料儲存",
      "基本的統計顯示"
    ],
    note: "舊版本已停止維護，建議升級到 2.0 版本"
  }
}

export class ChangelogManager {
  constructor() {
    // 從瀏覽器存儲中讀取當前版本，如果沒有則使用預設值
    this.currentVersion = localStorage.getItem('app-current-version') || '2.0.7.1'
  }

  // 獲取當前版本資訊
  getCurrentVersionInfo() {
    return {
      version: this.currentVersion,
      ...CHANGELOG[this.currentVersion]
    }
  }

  // 獲取所有版本歷史
  getAllVersions() {
    return Object.keys(CHANGELOG).map(version => ({
      version,
      ...CHANGELOG[version]
    })).sort((a, b) => new Date(b.date) - new Date(a.date))
  }

  // 獲取指定版本資訊
  getVersionInfo(version) {
    return CHANGELOG[version] ? {
      version,
      ...CHANGELOG[version]
    } : null
  }

  // 渲染版本資訊 HTML
  renderVersionInfo(versionInfo, isCurrentVersion = false) {
    const { version, date, title, features = [], bugfixes = [], improvements = [], note } = versionInfo
    
    return `
      <div class="mb-6 p-4 border rounded-lg ${isCurrentVersion ? 'border-primary bg-blue-50' : 'border-gray-200'}">
        <div class="flex items-center justify-between mb-3">
          <div class="flex items-center space-x-2">
            <h3 class="text-lg font-bold text-gray-800">v${version}</h3>
            ${isCurrentVersion ? '<span class="px-2 py-1 text-xs bg-primary text-white rounded-full">目前版本</span>' : ''}
          </div>
          <span class="text-sm text-gray-500">${date}</span>
        </div>
        
        <h4 class="text-md font-semibold text-gray-700 mb-3">${title}</h4>
        
        ${note ? `<div class="mb-3 p-2 bg-yellow-100 border border-yellow-300 rounded text-sm text-yellow-800">${note}</div>` : ''}
        
        ${features.length > 0 ? `
          <div class="mb-3">
            <h5 class="text-sm font-semibold text-green-600 mb-2">✨ 新功能</h5>
            <ul class="text-sm text-gray-600 space-y-1">
              ${features.map(feature => `<li class="flex items-start"><span class="text-green-500 mr-2">•</span>${feature}</li>`).join('')}
            </ul>
          </div>
        ` : ''}
        
        ${bugfixes.length > 0 ? `
          <div class="mb-3">
            <h5 class="text-sm font-semibold text-red-600 mb-2">🐛 錯誤修復</h5>
            <ul class="text-sm text-gray-600 space-y-1">
              ${bugfixes.map(fix => `<li class="flex items-start"><span class="text-red-500 mr-2">•</span>${fix}</li>`).join('')}
            </ul>
          </div>
        ` : ''}
        
        ${improvements.length > 0 ? `
          <div class="mb-3">
            <h5 class="text-sm font-semibold text-blue-600 mb-2">🔧 改進優化</h5>
            <ul class="text-sm text-gray-600 space-y-1">
              ${improvements.map(improvement => `<li class="flex items-start"><span class="text-blue-500 mr-2">•</span>${improvement}</li>`).join('')}
            </ul>
          </div>
        ` : ''}
      </div>
    `
  }

  // 渲染當前版本更新摘要（用於設定頁面）
  renderCurrentVersionSummary() {
    const currentInfo = this.getCurrentVersionInfo()
    const { features = [], bugfixes = [], improvements = [] } = currentInfo
    
    return `
      <!-- 版本標題 -->
      <div class="mb-3">
        <h4 class="font-semibold text-gray-800 text-base">${currentInfo.title}</h4>
      </div>
      
      <!-- 更新內容 -->
      <div class="space-y-2">
        ${features.length > 0 ? `
          <div>
            <h5 class="text-xs font-semibold text-green-600 mb-1">✨ 新功能</h5>
            <ul class="text-xs text-gray-600 space-y-1 ml-2">
              ${features.slice(0, 3).map(feature => `<li class="flex items-start"><span class="text-green-500 mr-1">•</span><span>${feature}</span></li>`).join('')}
              ${features.length > 3 ? `<li class="text-gray-400">...還有 ${features.length - 3} 項功能</li>` : ''}
            </ul>
          </div>
        ` : ''}
        
        ${bugfixes.length > 0 ? `
          <div>
            <h5 class="text-xs font-semibold text-red-600 mb-1">🐛 錯誤修復</h5>
            <ul class="text-xs text-gray-600 space-y-1 ml-2">
              ${bugfixes.slice(0, 3).map(fix => `<li class="flex items-start"><span class="text-red-500 mr-1">•</span><span>${fix}</span></li>`).join('')}
              ${bugfixes.length > 3 ? `<li class="text-gray-400">...還有 ${bugfixes.length - 3} 項修復</li>` : ''}
            </ul>
          </div>
        ` : ''}
        
        ${improvements.length > 0 ? `
          <div>
            <h5 class="text-xs font-semibold text-blue-600 mb-1">🔧 改進優化</h5>
            <ul class="text-xs text-gray-600 space-y-1 ml-2">
              ${improvements.slice(0, 3).map(improvement => `<li class="flex items-start"><span class="text-blue-500 mr-1">•</span><span>${improvement}</span></li>`).join('')}
              ${improvements.length > 3 ? `<li class="text-gray-400">...還有 ${improvements.length - 3} 項優化</li>` : ''}
            </ul>
          </div>
        ` : ''}
      </div>
    `
  }

  // 顯示完整更新日誌 Modal
  showChangelogModal() {
    // 移除現有的 modal
    const existingModal = document.getElementById('changelog-modal')
    if (existingModal) {
      existingModal.remove()
    }

    const modal = document.createElement('div')
    modal.id = 'changelog-modal'
    modal.className = 'fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4'
    
    const allVersions = this.getAllVersions()
    
    modal.innerHTML = `
      <div class="bg-white rounded-lg max-w-2xl w-full max-h-[80vh] flex flex-col">
        <div class="flex items-center justify-between p-4 border-b border-gray-200">
          <h3 class="text-xl font-semibold text-gray-800">版本更新日誌</h3>
          <button id="close-changelog-btn" class="text-gray-500 hover:text-gray-700">
            <i class="fas fa-times text-xl"></i>
          </button>
        </div>
        
        <div class="flex-1 overflow-y-auto p-4">
          ${allVersions.map((version, index) => 
            this.renderVersionInfo(version, index === 0)
          ).join('')}
        </div>
        
        <div class="p-4 border-t border-gray-200 text-center">
          <p class="text-sm text-gray-500">感謝您使用輕鬆記帳！</p>
        </div>
      </div>
    `
    
    document.body.appendChild(modal)
    
    // 事件監聽
    document.getElementById('close-changelog-btn').addEventListener('click', () => {
      modal.remove()
    })
    
    // 點擊背景關閉
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        modal.remove()
      }
    })
  }
}