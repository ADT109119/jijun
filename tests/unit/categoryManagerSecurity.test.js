// categoryManager.js 安全補強回歸測試（H01 圖示白名單 / M02 顏色白名單 /
// M01 Sortable 洩漏 / M03 UUID id / CSS selector 注入防呆）
// 對應 2026-09-29 安全補強 + 2026-09-30 code review 修復（renderIcons 反白
// querySelector 對歷史非法 icon 拋 SyntaxError 中斷彈窗初始化）。
import { describe, it, expect, beforeEach, vi } from 'vitest'

// Sortable mock：追蹤實例與 destroy（M01 驗證）
const sortableInstances = []
vi.mock('sortablejs', () => ({
    default: class SortableMock {
        constructor(el, opts) {
            this.el = el
            this.opts = opts
            this.destroyed = false
            sortableInstances.push(this)
        }
        destroy() {
            this.destroyed = true
        }
    },
}))

// customAlert mock：避免非同步 modal 干擾（並供存檔拒绝路徑斷言）
const { customAlertMock } = vi.hoisted(() => ({
    customAlertMock: vi.fn(async () => true),
}))
vi.mock('../../src/js/utils.js', async importOriginal => {
    const original = await importOriginal()
    return { ...original, customAlert: customAlertMock }
})

import {
    CategoryManager,
    isSafeIconClass,
    isSafeHexColor,
} from '../../src/js/categoryManager.js'

function createMockDataService() {
    const settings = new Map()
    return {
        getCategorySetting: vi.fn(async key => settings.get(key) || null),
        saveCategorySetting: vi.fn(async (key, value) => {
            settings.set(key, { value })
            return true
        }),
        saveSetting: vi.fn(async () => true),
        getSetting: vi.fn(async () => null),
        getRecords: vi.fn(async () => []),
        updateRecord: vi.fn(async () => true),
        logChange: vi.fn(),
        activeLedgerId: 1,
    }
}

describe('categoryManager 安全補強', () => {
    let cm
    let mockDS

    beforeEach(() => {
        document.body.innerHTML = ''
        sortableInstances.length = 0
        customAlertMock.mockClear()
        mockDS = createMockDataService()
        cm = new CategoryManager(mockDS)
        cm.customCategories = { expense: [], income: [] }
        cm.categoryOrder = { expense: [], income: [] }
        cm.hiddenCategories = { expense: [], income: [] }
    })

    // ── isSafeIconClass（H01 白名單）───────────────────────────────────
    describe('isSafeIconClass', () => {
        it('接受標準 FontAwesome 寫法', () => {
            expect(isSafeIconClass('fas fa-heart')).toBe(true)
            expect(isSafeIconClass('far fa-clock')).toBe(true)
            expect(isSafeIconClass('fab fa-github')).toBe(true)
            expect(isSafeIconClass('fa-solid fa-grip-vertical')).toBe(true)
            expect(isSafeIconClass('fa-regular fa-pen')).toBe(true)
            expect(isSafeIconClass('fa-brands fa-x')).toBe(true)
            expect(isSafeIconClass('  fas fa-heart  ')).toBe(true) // trim
        })

        it('拒絕 class breakout 注入', () => {
            expect(isSafeIconClass('"><img src=x onerror=alert(1)>')).toBe(
                false
            )
            expect(isSafeIconClass('fas fa-heart" onclick="alert(1)')).toBe(
                false
            )
            expect(isSafeIconClass('fa-solid fa-x onmouseover=alert(1)')).toBe(
                false
            )
            expect(isSafeIconClass('fa-solid fa-x></i><script>')).toBe(false)
        })

        it('拒絕非 fa-* 前綴與非法字元', () => {
            expect(isSafeIconClass('evil fa-heart')).toBe(false)
            expect(isSafeIconClass('fa-heart')).toBe(false) // 缺前綴
            expect(isSafeIconClass('fas fa_heart')).toBe(false) // 底線
            expect(isSafeIconClass('fas fa-heart; background:red')).toBe(false)
        })

        it('拒絕非字串輸入', () => {
            expect(isSafeIconClass(null)).toBe(false)
            expect(isSafeIconClass(undefined)).toBe(false)
            expect(isSafeIconClass(123)).toBe(false)
            expect(isSafeIconClass({})).toBe(false)
        })
    })

    // ── isSafeHexColor（M02 白名單）────────────────────────────────────
    describe('isSafeHexColor', () => {
        it('接受 3/4/6/8 位 hex', () => {
            expect(isSafeHexColor('#fff')).toBe(true)
            expect(isSafeHexColor('#ffff')).toBe(true)
            expect(isSafeHexColor('#ff0000')).toBe(true)
            expect(isSafeHexColor('#ff000088')).toBe(true)
            expect(isSafeHexColor('#A1B2C3')).toBe(true)
        })

        it('拒絕夾帶分號/冒號的 CSS 逃脫值', () => {
            expect(isSafeHexColor('#fff; background-image:url(x)')).toBe(false)
            expect(isSafeHexColor('#fff" style="color:red')).toBe(false)
            expect(isSafeHexColor('red')).toBe(false)
            expect(isSafeHexColor('bg-red-500')).toBe(false)
            expect(isSafeHexColor('#ff')).toBe(false) // 2 位非法
            expect(isSafeHexColor('#ff000')).toBe(false) // 5 位非法
            expect(isSafeHexColor('#ff00000')).toBe(false) // 7 位非法
        })

        it('拒絕非字串輸入', () => {
            expect(isSafeHexColor(null)).toBe(false)
            expect(isSafeHexColor(undefined)).toBe(false)
            expect(isSafeHexColor(0xff0000)).toBe(false)
        })
    })

    // ── 管理彈窗清單渲染（H01/M02 渲染面）──────────────────────────────
    describe('showManageCategoriesModal 歷史髒資料渲染', () => {
        function seedCategories(cats) {
            cm.customCategories = { expense: cats, income: [] }
        }

        it('惡意 icon 歷史值不產生 img 節點，退回中性眼睛圖示', () => {
            seedCategories([
                {
                    id: 'custom_evil',
                    name: '髒資料',
                    icon: '"><img src=x onerror=alert(1)>',
                    color: 'bg-red-500',
                    isCustom: true,
                },
            ])
            expect(() =>
                cm.showManageCategoriesModal('expense')
            ).not.toThrow()
            expect(document.querySelector('#manage-categories-modal img')).toBeNull()
            const iconEl = document.querySelector(
                '#manage-categories-modal [data-id="custom_evil"] .rounded-full i'
            )
            expect(iconEl.className).toContain('fa-eye')
            cm.closeManageCategoriesModal()
        })

        it('惡意 hex 顏色逃脫值不寫入 style 屬性', () => {
            seedCategories([
                {
                    id: 'custom_evilcolor',
                    name: '顏色逃逸',
                    icon: 'fas fa-heart',
                    color: '#fff; background-image:url(evil)',
                    isCustom: true,
                },
            ])
            cm.showManageCategoriesModal('expense')
            const swatch = document.querySelector(
                '#manage-categories-modal [data-id="custom_evilcolor"] .rounded-full'
            )
            expect(swatch.getAttribute('style')).toBeNull()
            expect(swatch.className).not.toContain('background-image')
            cm.closeManageCategoriesModal()
        })

        it('合法 bg-* class 正常套用，合法 hex 寫入 style', () => {
            seedCategories([
                {
                    id: 'custom_bg',
                    name: 'bg分類',
                    icon: 'fas fa-heart',
                    color: 'bg-red-500',
                    isCustom: true,
                },
                {
                    id: 'custom_hex',
                    name: 'hex分類',
                    icon: 'fas fa-star',
                    color: '#ff0000',
                    isCustom: true,
                },
            ])
            cm.showManageCategoriesModal('expense')
            const swatches = document.querySelectorAll(
                '#manage-categories-modal .sortable-item .rounded-full'
            )
            const bgSwatch = [...swatches].find(s =>
                s.className.includes('bg-red-500')
            )
            const hexSwatch = [...swatches].find(s =>
                (s.getAttribute('style') || '').includes('#ff0000')
            )
            expect(bgSwatch).toBeDefined()
            expect(hexSwatch).toBeDefined()
            cm.closeManageCategoriesModal()
        })

        it('非 hex 也非 bg-* 的任意 class 不套用顏色（class breakout 阻斷）', () => {
            seedCategories([
                {
                    id: 'custom_breakout',
                    name: 'class逃逸',
                    icon: 'fas fa-heart',
                    color: 'bg-red-500" data-evil="1',
                    isCustom: true,
                },
            ])
            cm.showManageCategoriesModal('expense')
            const swatch = document.querySelector(
                '#manage-categories-modal [data-id="custom_breakout"] .rounded-full'
            )
            expect(swatch.getAttribute('data-evil')).toBeNull()
            expect(swatch.getAttribute('style')).toBeNull()
            cm.closeManageCategoriesModal()
        })

        it('color undefined 舊資料不崩潰', () => {
            seedCategories([
                {
                    id: 'custom_nocolor',
                    name: '無顏色',
                    icon: 'fas fa-heart',
                    isCustom: true,
                },
            ])
            expect(() =>
                cm.showManageCategoriesModal('expense')
            ).not.toThrow()
            expect(
                document.querySelector('#manage-categories-modal .sortable-item')
            ).not.toBeNull()
            cm.closeManageCategoriesModal()
        })
    })

    // ── 新增/編輯彈窗（H01 表單面 + selector 注入防呆）─────────────────
    describe('showAddCategoryModal 編輯模式歷史髒資料', () => {
        const evilIcon = '"><img src=x onerror=alert(1)>'

        function openEdit(icon) {
            cm.showAddCategoryModal('expense', {
                id: 'custom_x',
                name: '舊分類',
                icon,
                color: '#fff000',
                isCustom: true,
            })
        }

        it('歷史惡意 icon 不產生 img 節點（初始預覽 escapeHTML）', () => {
            openEdit(evilIcon)
            expect(
                document.querySelector('#add-category-modal img')
            ).toBeNull()
            cm.closeAddCategoryModal()
        })

        it('renderIcons 反白對歷史非法 icon 不拋 SyntaxError（CSS selector 注入防呆）', () => {
            // selectedIcon 含雙引號時，[data-icon="..."] 選擇器若直接組字串
            // 會拋 SyntaxError 中斷整個彈窗初始化——修復後靜默跳過反白。
            expect(() => openEdit(evilIcon)).not.toThrow()
            expect(
                document.getElementById('add-category-modal')
            ).not.toBeNull()
            cm.closeAddCategoryModal()
        })

        it('非法圖示輸入顯示純文字警示且不採用為 selectedIcon', () => {
            openEdit('fas fa-heart')
            const input = document.getElementById('custom-icon-input')
            const preview = document.getElementById('icon-preview')
            input.value = evilIcon
            document
                .getElementById('preview-icon-btn')
                .dispatchEvent(new MouseEvent('click', { bubbles: true }))
            expect(preview.querySelector('img')).toBeNull()
            expect(preview.textContent).toBe('格式不正確')
            cm.closeAddCategoryModal()
        })

        it('合法圖示輸入正常渲染預覽', () => {
            openEdit('fas fa-heart')
            const input = document.getElementById('custom-icon-input')
            const preview = document.getElementById('icon-preview')
            input.value = 'fa-solid fa-mug-hot'
            document
                .getElementById('preview-icon-btn')
                .dispatchEvent(new MouseEvent('click', { bubbles: true }))
            const i = preview.querySelector('i')
            expect(i).not.toBeNull()
            expect(i.className).toContain('fa-mug-hot')
            cm.closeAddCategoryModal()
        })

        it('存檔時歷史非法 icon 被拒絕（customAlert，不寫入）', async () => {
            openEdit(evilIcon)
            // 名稱填合法值後直接存檔：selectedIcon 仍為歷史非法值
            document.getElementById('category-name').value = '測試'
            const updateSpy = vi
                .spyOn(cm, 'updateCustomCategory')
                .mockResolvedValue(true)
            document
                .getElementById('save-category-btn')
                .dispatchEvent(new MouseEvent('click', { bubbles: true }))
            await new Promise(r => setTimeout(r, 0))
            expect(customAlertMock).toHaveBeenCalled()
            expect(updateSpy).not.toHaveBeenCalled()
            updateSpy.mockRestore()
            cm.closeAddCategoryModal()
        })

        it('新增分類 id 使用 UUID（同毫秒不碰撞）', async () => {
            cm.showAddCategoryModal('expense')
            document.getElementById('category-name').value = 'A'
            const input = document.getElementById('custom-icon-input')
            input.value = 'fas fa-heart'
            document
                .getElementById('preview-icon-btn')
                .dispatchEvent(new MouseEvent('click', { bubbles: true }))
            // 顏色需非空：模擬自訂取色器
            const picker = document.getElementById('custom-color-picker-input')
            picker.value = '#123456'
            picker.dispatchEvent(new Event('input', { bubbles: true }))
            const addSpy = vi
                .spyOn(cm, 'addCustomCategory')
                .mockImplementation(async () => false) // 不關閉 modal，可重複點擊
            const saveBtn = document.getElementById('save-category-btn')
            saveBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }))
            await new Promise(r => setTimeout(r, 0))
            saveBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }))
            await new Promise(r => setTimeout(r, 0))
            expect(addSpy).toHaveBeenCalledTimes(2)
            const [, c1] = addSpy.mock.calls[0]
            const [, c2] = addSpy.mock.calls[1]
            expect(c1.id.startsWith('custom_')).toBe(true)
            // UUID 長度 36，遠超 Date.now()（13 碼）
            expect(c1.id.length).toBe('custom_'.length + 36)
            expect(c1.id).not.toBe(c2.id)
            addSpy.mockRestore()
        })
    })

    // ── M01 Sortable 生命週期 ──────────────────────────────────────────
    describe('管理彈窗 Sortable 洩漏防護', () => {
        it('開啟彈窗建立 Sortable 實例，關閉時 destroy', () => {
            cm.showManageCategoriesModal('expense')
            expect(sortableInstances).toHaveLength(1)
            expect(sortableInstances[0].destroyed).toBe(false)
            cm.closeManageCategoriesModal()
            expect(sortableInstances[0].destroyed).toBe(true)
        })

        it('重複開啟不洩漏：舊實例先 destroy', () => {
            cm.showManageCategoriesModal('expense')
            cm.closeManageCategoriesModal()
            cm.showManageCategoriesModal('expense')
            expect(sortableInstances).toHaveLength(2)
            expect(sortableInstances[0].destroyed).toBe(true)
            expect(sortableInstances[1].destroyed).toBe(false)
            cm.closeManageCategoriesModal()
        })

        it('destroy() 釋放 Sortable 且移除彈窗', () => {
            cm.showManageCategoriesModal('expense')
            cm.destroy()
            expect(sortableInstances[0].destroyed).toBe(true)
            expect(document.getElementById('manage-categories-modal')).toBeNull()
        })

        it('未開啟彈窗時 destroy() 不拋錯', () => {
            expect(() => cm.destroy()).not.toThrow()
        })
    })
})
