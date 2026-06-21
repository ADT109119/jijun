import { describe, it, expect, vi, beforeEach } from 'vitest'
import { PluginManager } from '../../src/js/pluginManager.js'

// ── 共用 mock ──────────────────────────────────────────
function createMockDataService() {
  const ds = {
    activeLedgerId: 1,
    db: {
      transaction: vi.fn(() => ({
        store: {
          getAll: vi.fn().mockResolvedValue([]),
          get: vi.fn().mockResolvedValue(null),
          put: vi.fn().mockResolvedValue(),
          delete: vi.fn().mockResolvedValue(),
        },
        done: Promise.resolve(),
        objectStore: () => ({ getAll: vi.fn().mockResolvedValue([]) }),
      })),
    },
    getSetting: vi.fn().mockResolvedValue(null),
    saveSetting: vi.fn().mockResolvedValue(),
    getRecords: vi.fn().mockResolvedValue([]),
    getDebts: vi.fn().mockResolvedValue([]),
    getContacts: vi.fn().mockResolvedValue([]),
    getAccounts: vi.fn().mockResolvedValue([]),
    addRecord: vi.fn().mockResolvedValue(1),
    addDebt: vi.fn().mockResolvedValue(1),
    addContact: vi.fn().mockResolvedValue(1),
  }
  return ds
}

function createMockApp() {
  return {
    categoryManager: {
      getAllCategories: vi.fn().mockResolvedValue([]),
      getCategoryById: vi.fn().mockResolvedValue(null),
    },
  }
}

// ── 測試開始 ───────────────────────────────────────────

describe('PluginManager — 建構與初始化', () => {
  let pm, ds, app

  beforeEach(() => {
    ds = createMockDataService()
    app = createMockApp()
    pm = new PluginManager(ds, app)
  })

  it('建構後 plugins 為空 Map', () => {
    expect(pm.plugins).toBeInstanceOf(Map)
    expect(pm.plugins.size).toBe(0)
  })

  it('建構後 customPages 為空 Map', () => {
    expect(pm.customPages).toBeInstanceOf(Map)
    expect(pm.customPages.size).toBe(0)
  })

  it('建構後 homeWidgets 為空 Map', () => {
    expect(pm.homeWidgets).toBeInstanceOf(Map)
    expect(pm.homeWidgets.size).toBe(0)
  })

  it('建構後 hooks 為空 Map', () => {
    expect(pm.hooks).toBeInstanceOf(Map)
    expect(pm.hooks.size).toBe(0)
  })

  it('init() 載入 widgetOrder 與 hiddenWidgets', async () => {
    ds.getSetting.mockImplementation(async key => {
      if (key === 'widgetOrder') return { value: ['widget-a', 'widget-b'] }
      if (key === 'hiddenWidgets') return { value: ['widget-hidden'] }
      return null
    })

    await pm.init()

    expect(pm.widgetOrder).toEqual(['widget-a', 'widget-b'])
    expect(pm.hiddenWidgets).toEqual(['widget-hidden'])
  })

  it('init() 沒有 savedOrder 時使用空陣列', async () => {
    await pm.init()
    expect(pm.widgetOrder).toEqual([])
    expect(pm.hiddenWidgets).toEqual([])
  })
})

describe('PluginManager — _escapeHTML', () => {
  let pm, ds, app

  beforeEach(() => {
    ds = createMockDataService()
    app = createMockApp()
    pm = new PluginManager(ds, app)
  })

  it('轉義 < 和 >', () => {
    expect(pm._escapeHTML('<script>alert(1)</script>')).toBe(
      '&lt;script&gt;alert(1)&lt;/script&gt;'
    )
  })

  it('轉義 & 字元', () => {
    expect(pm._escapeHTML('A & B')).toBe('A &amp; B')
  })

  it('轉義雙引號', () => {
    // textContent 方式不轉義 " (僅在 innerHTML 賦值時才轉義)
    expect(pm._escapeHTML('He said "hi"')).toBe('He said "hi"')
  })

  it('單引號不轉義', () => {
    expect(pm._escapeHTML("It's me")).toBe("It's me")
  })

  it('純文字不改變', () => {
    expect(pm._escapeHTML('Hello World')).toBe('Hello World')
  })

  it('空字串回傳空字串', () => {
    expect(pm._escapeHTML('')).toBe('')
  })
})

describe('PluginManager — createPluginContext', () => {
  let pm, ds, app

  beforeEach(() => {
    ds = createMockDataService()
    app = createMockApp()
    pm = new PluginManager(ds, app)
  })

  it('無權限時 storage 投擲錯誤', () => {
    const ctx = pm.createPluginContext('test-plugin', [])
    expect(() => ctx.storage.getItem('key')).toThrow(/Permission Denied/)
  })

  it('有 storage 權限且有 PluginStorage 時回傳該儲存', () => {
    const mockStorage = { getItem: vi.fn().mockResolvedValue('val') }
    const ctx = pm.createPluginContext('test-plugin', ['storage'], mockStorage)
    expect(ctx.storage).toBe(mockStorage)
  })

  it('無 data:read 權限時 getRecords 投擲錯誤', () => {
    const ctx = pm.createPluginContext('test-plugin', [])
    expect(() => ctx.data.getRecords()).toThrow(/Permission Denied/)
  })

  it('有 data:read 權限時可以讀取資料', () => {
    const ctx = pm.createPluginContext('test-plugin', ['data:read'])
    ctx.data.getRecords()
    expect(ds.getRecords).toHaveBeenCalled()
  })

  it('有 data:read 但無 data:write 時 addRecord 投擲錯誤', () => {
    const ctx = pm.createPluginContext('test-plugin', ['data:read'])
    expect(() => ctx.data.addRecord({})).toThrow(/Permission Denied/)
  })

  it('有 data:write 但無 data:read 時 getRecords 投擲錯誤', () => {
    const ctx = pm.createPluginContext('test-plugin', ['data:write'])
    expect(() => ctx.data.getRecords()).toThrow(/Permission Denied/)
  })

  it('同時有 data:read 和 data:write 時都可使用', () => {
    const ctx = pm.createPluginContext('test-plugin', [
      'data:read',
      'data:write',
    ])
    ctx.data.getRecords()
    ctx.data.addRecord({})
    expect(ds.getRecords).toHaveBeenCalled()
    expect(ds.addRecord).toHaveBeenCalled()
  })

  it('無 ui 權限時 showToast 投擲錯誤', () => {
    const ctx = pm.createPluginContext('test-plugin', [])
    expect(() => ctx.ui.showToast('hello')).toThrow(/Permission Denied/)
  })

  it('events API 始終可用', () => {
    const ctx = pm.createPluginContext('test-plugin', [])
    expect(typeof ctx.events.on).toBe('function')
    expect(typeof ctx.events.off).toBe('function')
  })

  it('appName 與 version 正確', () => {
    const ctx = pm.createPluginContext('test-plugin', [])
    expect(ctx.appName).toBe('Easy Accounting')
    expect(typeof ctx.version).toBe('string')
  })

  it('activeLedgerId 回傳當前的 activeLedgerId', () => {
    const ctx = pm.createPluginContext('test-plugin', [])
    expect(ctx.activeLedgerId()).toBe(1)
  })
})

describe('PluginManager — registerPage / registerHomeWidget', () => {
  let pm, ds, app

  beforeEach(() => {
    ds = createMockDataService()
    app = createMockApp()
    pm = new PluginManager(ds, app)
  })

  it('registerPage 可註冊自訂頁面', () => {
    const renderFn = vi.fn()
    pm.registerPage('test-page', '測試頁面', renderFn)
    expect(pm.customPages.has('test-page')).toBe(true)
    const page = pm.customPages.get('test-page')
    expect(page.title).toBe('測試頁面')
    expect(page.renderFn).toBe(renderFn)
  })

  it('registerPage 覆蓋既有頁面', () => {
    const fn1 = vi.fn()
    const fn2 = vi.fn()
    pm.registerPage('test-page', '頁面 A', fn1)
    pm.registerPage('test-page', '頁面 B', fn2)
    const page = pm.customPages.get('test-page')
    expect(page.title).toBe('頁面 B')
    expect(page.renderFn).toBe(fn2)
  })

  it('getCustomPage 回傳已註冊的頁面', () => {
    pm.registerPage('test-page', '測試', vi.fn())
    expect(pm.getCustomPage('test-page')).toBeDefined()
    expect(pm.getCustomPage('non-existent')).toBeUndefined()
  })

  it('registerHomeWidget 需要字串 id', () => {
    pm.registerHomeWidget(
      'widget-1',
      vi.fn(el => {
        el.innerHTML = 'hello'
      })
    )
    expect(pm.homeWidgets.has('widget-1')).toBe(true)
  })

  it('registerHomeWidget 非字串 id 被忽略', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    pm.registerHomeWidget(123, vi.fn())
    expect(warnSpy).toHaveBeenCalled()
    expect(pm.homeWidgets.size).toBe(0)
    warnSpy.mockRestore()
  })

  it('registerHomeWidget 自動新增至 widgetOrder', () => {
    pm.registerHomeWidget('widget-a', vi.fn())
    expect(pm.widgetOrder).toContain('widget-a')
  })
})

describe('PluginManager — renderHomeWidgets / renderSingleWidget', () => {
  let pm, ds, app

  beforeEach(() => {
    ds = createMockDataService()
    app = createMockApp()
    pm = new PluginManager(ds, app)
  })

  it('沒有 widget 時不渲染', () => {
    const container = document.createElement('div')
    pm.renderHomeWidgets(container)
    expect(container.innerHTML).toBe('')
  })

  it('container 為 null 時不拋錯', () => {
    pm.registerHomeWidget('w1', vi.fn())
    expect(() => pm.renderHomeWidgets(null)).not.toThrow()
  })

  it('依 widgetOrder 順序渲染', () => {
    const rendered = []
    pm.registerHomeWidget(
      'w2',
      vi.fn(el => {
        el.textContent = 'w2'
        rendered.push('w2')
      })
    )
    pm.registerHomeWidget(
      'w1',
      vi.fn(el => {
        el.textContent = 'w1'
        rendered.push('w1')
      })
    )
    pm.widgetOrder = ['w1', 'w2']

    const container = document.createElement('div')
    pm.renderHomeWidgets(container)
    expect(rendered).toEqual(['w1', 'w2'])
  })

  it('hiddenWidgets 中的 widget 不被渲染', () => {
    pm.registerHomeWidget('w1', vi.fn())
    pm.registerHomeWidget('w2', vi.fn())
    pm.hiddenWidgets = ['w1']
    pm.widgetOrder = ['w1', 'w2']

    const container = document.createElement('div')
    pm.renderHomeWidgets(container)
    // 只有 w2 的 widget div
    expect(container.querySelectorAll('.plugin-widget').length).toBe(1)
  })

  it('renderSingleWidget 捕捉 renderFn 的錯誤', () => {
    const container = document.createElement('div')
    const badRender = () => {
      throw new Error('render error')
    }
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    pm.renderSingleWidget(container, 'bad-widget', badRender)

    expect(errSpy).toHaveBeenCalled()
    expect(container.children.length).toBe(0)
    errSpy.mockRestore()
  })

  it('renderSingleWidget 正確建立 widget div', () => {
    const container = document.createElement('div')
    pm.renderSingleWidget(container, 'my-widget', el => {
      el.textContent = 'content'
    })

    expect(container.children.length).toBe(1)
    expect(container.firstChild.dataset.pluginId).toBe('my-widget')
    expect(container.firstChild.className).toBe('plugin-widget mb-4')
  })
})

describe('PluginManager — moveWidget / saveWidgetOrder', () => {
  let pm, ds, app

  beforeEach(() => {
    ds = createMockDataService()
    app = createMockApp()
    pm = new PluginManager(ds, app)
  })

  it('moveWidget 向上移動 widget', async () => {
    pm.widgetOrder = ['w1', 'w2', 'w3']
    await pm.moveWidget('w2', -1)
    expect(pm.widgetOrder).toEqual(['w2', 'w1', 'w3'])
    expect(ds.saveSetting).toHaveBeenCalled()
  })

  it('moveWidget 向下移動 widget', async () => {
    pm.widgetOrder = ['w1', 'w2', 'w3']
    await pm.moveWidget('w1', 1)
    expect(pm.widgetOrder).toEqual(['w2', 'w1', 'w3'])
  })

  it('moveWidget 超出邊界不移動', async () => {
    pm.widgetOrder = ['w1', 'w2']
    await pm.moveWidget('w1', -1) // 已經在最上
    expect(pm.widgetOrder).toEqual(['w1', 'w2'])

    await pm.moveWidget('w2', 1) // 已經在最下
    expect(pm.widgetOrder).toEqual(['w1', 'w2'])
  })

  it('moveWidget 不存在的 id 不做任何事', async () => {
    pm.widgetOrder = ['w1', 'w2']
    await pm.moveWidget('w99', 1)
    expect(pm.widgetOrder).toEqual(['w1', 'w2'])
    expect(ds.saveSetting).not.toHaveBeenCalled()
  })

  it('saveWidgetOrder 儲存設定', async () => {
    pm.widgetOrder = ['a', 'b']
    await pm.saveWidgetOrder()
    expect(ds.saveSetting).toHaveBeenCalledWith({
      key: 'widgetOrder',
      value: ['a', 'b'],
    })
  })
})

describe('PluginManager — Hooks 系統', () => {
  let pm, ds, app

  beforeEach(() => {
    ds = createMockDataService()
    app = createMockApp()
    pm = new PluginManager(ds, app)
  })

  it('registerHook 可註冊鉤子', () => {
    const cb = vi.fn()
    pm.registerHook('beforeAdd', cb)
    expect(pm.hooks.has('beforeAdd')).toBe(true)
  })

  it('registerHook 可註冊多個回呼', () => {
    const cb1 = vi.fn()
    const cb2 = vi.fn()
    pm.registerHook('beforeAdd', cb1)
    pm.registerHook('beforeAdd', cb2)
    expect(pm.hooks.get('beforeAdd').size).toBe(2)
  })

  it('unregisterHook 移除特定回呼', () => {
    const cb1 = vi.fn()
    const cb2 = vi.fn()
    pm.registerHook('beforeAdd', cb1)
    pm.registerHook('beforeAdd', cb2)
    pm.unregisterHook('beforeAdd', cb1)
    expect(pm.hooks.get('beforeAdd').size).toBe(1)
  })

  it('triggerHook 依序執行回呼', async () => {
    const order = []
    const cb1 = vi.fn().mockImplementation(() => {
      order.push(1)
    })
    const cb2 = vi.fn().mockImplementation(() => {
      order.push(2)
    })
    pm.registerHook('test', cb1)
    pm.registerHook('test', cb2)

    await pm.triggerHook('test', {})
    expect(order).toEqual([1, 2])
  })

  it('triggerHook 回呼可修改 payload', async () => {
    const cb = vi.fn().mockImplementation(p => ({ ...p, modified: true }))
    pm.registerHook('test', cb)

    const result = await pm.triggerHook('test', { original: true })
    expect(result).toEqual({ original: true, modified: true })
  })

  it('triggerHook 回呼回傳 null 時中斷', async () => {
    const cb1 = vi.fn().mockImplementation(() => null)
    const cb2 = vi.fn()
    pm.registerHook('test', cb1)
    pm.registerHook('test', cb2)

    const result = await pm.triggerHook('test', {})
    expect(result).toBeNull()
    expect(cb2).not.toHaveBeenCalled()
  })

  it('triggerHook 回呼 throw 時繼續執行下一個', async () => {
    const order = []
    const cb1 = vi.fn().mockImplementation(() => {
      throw new Error('fail')
    })
    const cb2 = vi.fn().mockImplementation(() => {
      order.push(2)
    })
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    pm.registerHook('test', cb1)
    pm.registerHook('test', cb2)

    await pm.triggerHook('test', {})
    expect(order).toEqual([2])
    errSpy.mockRestore()
  })

  it('triggerHook 沒有註冊的回傳原始 payload', async () => {
    const payload = { key: 'value' }
    const result = await pm.triggerHook('nonexistent', payload)
    expect(result).toBe(payload)
  })

  it('triggerHook 回呼回傳 undefined 不覆蓋 payload', async () => {
    const cb = vi.fn().mockImplementation(() => undefined)
    pm.registerHook('test', cb)
    const payload = { key: 'value' }
    const result = await pm.triggerHook('test', payload)
    expect(result).toBe(payload)
  })
})

describe('PluginManager — compareVersions', () => {
  let pm, ds, app

  beforeEach(() => {
    ds = createMockDataService()
    app = createMockApp()
    pm = new PluginManager(ds, app)
  })

  it('相同版本回傳 0', () => {
    expect(pm.compareVersions('1.0.0', '1.0.0')).toBe(0)
  })

  it('v1 大於 v2 回傳 1', () => {
    expect(pm.compareVersions('2.0.0', '1.0.0')).toBe(1)
    expect(pm.compareVersions('1.2.0', '1.1.0')).toBe(1)
    expect(pm.compareVersions('1.0.2', '1.0.1')).toBe(1)
  })

  it('v1 小於 v2 回傳 -1', () => {
    expect(pm.compareVersions('1.0.0', '2.0.0')).toBe(-1)
    expect(pm.compareVersions('1.1.0', '1.2.0')).toBe(-1)
    expect(pm.compareVersions('1.0.1', '1.0.2')).toBe(-1)
  })

  it('不同長度版本比較', () => {
    expect(pm.compareVersions('1.0', '1.0.0')).toBe(0)
    expect(pm.compareVersions('1.1', '1.0.9')).toBe(1)
    expect(pm.compareVersions('1', '1.0.1')).toBe(-1)
  })

  it('null 或 undefined 回傳 0', () => {
    expect(pm.compareVersions(null, '1.0')).toBe(0)
    expect(pm.compareVersions('1.0', undefined)).toBe(0)
    expect(pm.compareVersions('', '')).toBe(0)
  })
})

describe('PluginManager — PERMISSION_LABELS', () => {
  let pm, ds, app

  beforeEach(() => {
    ds = createMockDataService()
    app = createMockApp()
    pm = new PluginManager(ds, app)
  })

  it('包含所有標準權限標籤', () => {
    const { PERMISSION_LABELS } = pm.constructor
    expect(PERMISSION_LABELS['storage']).toBeDefined()
    expect(PERMISSION_LABELS['data:read']).toBeDefined()
    expect(PERMISSION_LABELS['data:write']).toBeDefined()
    expect(PERMISSION_LABELS['ui']).toBeDefined()
    expect(PERMISSION_LABELS['network']).toBeDefined()
    expect(PERMISSION_LABELS['camera']).toBeDefined()
  })

  it('每個權限有 label 和 desc', () => {
    const { PERMISSION_LABELS } = pm.constructor
    for (const [_key, val] of Object.entries(PERMISSION_LABELS)) {
      expect(val.label).toBeDefined()
      expect(val.desc).toBeDefined()
      expect(val.icon).toBeDefined()
    }
  })
})

describe('PluginManager — getPluginName', () => {
  let pm, ds, app

  beforeEach(() => {
    ds = createMockDataService()
    app = createMockApp()
    pm = new PluginManager(ds, app)
  })

  it('已知插件回傳名稱', () => {
    const mockPlugin = { meta: { name: '測試插件' } }
    pm.plugins.set('test-id', mockPlugin)
    expect(pm.getPluginName('test-id')).toBe('測試插件')
  })

  it('未知插件回傳 null', () => {
    expect(pm.getPluginName('nonexistent')).toBeNull()
  })
})

describe('PluginManager — _getSandboxWrapper', () => {
  let pm, ds, app

  beforeEach(() => {
    ds = createMockDataService()
    app = createMockApp()
    pm = new PluginManager(ds, app)
  })

  it('無 network 權限時包含網路 API 阻擋', () => {
    const wrapper = pm._getSandboxWrapper([])
    expect(wrapper).toContain('fetch')
    expect(wrapper).toContain('XMLHttpRequest')
    expect(wrapper).toContain('WebSocket')
  })

  it('有 network 權限時不包含網路 API 阻擋', () => {
    const wrapper = pm._getSandboxWrapper(['network'])
    expect(wrapper).not.toContain(
      'Permission Denied: 此插件未取得「網路存取」權限，無法使用 fetch'
    )
  })

  it('包含 localStorage 阻擋', () => {
    const wrapper = pm._getSandboxWrapper([])
    expect(wrapper).toContain('localStorage')
    expect(wrapper).toContain('Access Denied')
  })

  it('包含 indexedDB 阻擋', () => {
    const wrapper = pm._getSandboxWrapper([])
    expect(wrapper).toContain('indexedDB')
    expect(wrapper).toContain('IndexedDB is not allowed')
  })

  it('包含 Function 和 eval 阻擋', () => {
    const wrapper = pm._getSandboxWrapper([])
    expect(wrapper).toContain('Function constructor is not allowed')
    expect(wrapper).toContain('eval() is not allowed')
  })
})
