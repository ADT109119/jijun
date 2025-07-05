// 分類配置模組
export const CATEGORIES = {
  expense: [
    { id: 'food', name: '飲食', icon: 'fas fa-utensils', color: 'bg-red-500' },
    { id: 'life', name: '日常', icon: 'fas fa-home', color: 'bg-blue-500' },
    { id: 'traffic', name: '交通', icon: 'fas fa-car', color: 'bg-green-500' },
    { id: 'fun', name: '娛樂', icon: 'fas fa-gamepad', color: 'bg-purple-500' },
    { id: 'medi', name: '醫療', icon: 'fas fa-hospital', color: 'bg-pink-500' },
    { id: 'edu', name: '教育', icon: 'fas fa-book', color: 'bg-indigo-500' },
    { id: 'another', name: '其他', icon: 'fas fa-box', color: 'bg-gray-500' }
  ],
  income: [
    { id: 'salary', name: '薪水', icon: 'fas fa-money-bill-wave', color: 'bg-green-600' },
    { id: 'bonus', name: '獎金', icon: 'fas fa-gift', color: 'bg-yellow-500' },
    { id: 'pocket', name: '零用錢', icon: 'fas fa-wallet', color: 'bg-pink-400' },
    { id: 'parttime', name: '兼職', icon: 'fas fa-clock', color: 'bg-blue-400' },
    { id: 'invest', name: '投資', icon: 'fas fa-chart-line', color: 'bg-emerald-500' },
    { id: 'interest', name: '利息', icon: 'fas fa-university', color: 'bg-cyan-500' },
    { id: 'another', name: '其他', icon: 'fas fa-box', color: 'bg-gray-500' }
  ]
}

export function getCategoryById(type, id) {
  // 先檢查預設分類
  let category = CATEGORIES[type].find(cat => cat.id === id)
  
  // 如果沒找到，檢查自定義分類
  if (!category && window.app && window.app.categoryManager) {
    const customCategories = window.app.categoryManager.customCategories[type] || []
    category = customCategories.find(cat => cat.id === id)
  }
  
  return category
}

export function getCategoryName(type, id) {
  const category = getCategoryById(type, id)
  return category ? category.name : '未知分類'
}

export function getCategoryIcon(type, id) {
  const category = getCategoryById(type, id)
  return category ? category.icon : 'fas fa-question'
}