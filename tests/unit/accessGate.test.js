import { describe, it, expect, beforeEach } from 'vitest'
import { createAccessGate } from '../../src/js/accessGate.js'

// createAccessGate 採用 factory 注入 code（核心邏輯與 build 常數解耦），
// 單元測試直接注入不同 code 驗證各情境；build 常數 __ACCESS_CODE__
// 只在 accessGate.js module 層接線一次（見該檔結尾）。

function memStorage() {
    const m = new Map()
    return {
        getItem: k => (m.has(k) ? m.get(k) : null),
        setItem: (k, v) => {
            m.set(k, String(v))
        },
        removeItem: k => {
            m.delete(k)
        },
    }
}

describe('accessGate (createAccessGate)', () => {
    let storage
    beforeEach(() => {
        storage = memStorage()
        document.body.innerHTML = ''
    })

    it('code 空（一般版）：立即授權、不渲染 overlay', async () => {
        const g = createAccessGate('', { storage })
        await g.ensureAccess()
        expect(g.isAccessGranted()).toBe(true)
        expect(document.getElementById('access-gate-overlay')).toBeNull()
    })

    it('code 非空未輸入：ensureAccess 不 resolve、渲染 overlay', async () => {
        const g = createAccessGate('1234', { storage })
        const p = g.ensureAccess()
        expect(document.getElementById('access-gate-overlay')).not.toBeNull()
        const settled = await Promise.race([
            p.then(() => true),
            new Promise(res => setTimeout(() => res(false), 50)),
        ])
        expect(settled).toBe(false)
    })

    it('輸入錯誤：不 resolve、顯示錯誤、輸入框清空', async () => {
        const g = createAccessGate('1234', { storage })
        const p = g.ensureAccess()
        const input = document.querySelector('#access-gate-overlay input')
        const btn = document.querySelector('#access-gate-overlay button')
        input.value = '0000'
        btn.click()
        const errorEl = document.querySelector(
            '#access-gate-overlay p:last-of-type'
        )
        expect(errorEl.textContent).toContain('不正確')
        expect(input.value).toBe('')
        const settled = await Promise.race([
            p.then(() => true),
            new Promise(res => setTimeout(() => res(false), 50)),
        ])
        expect(settled).toBe(false)
        expect(g.isAccessGranted()).toBe(false)
    })

    it('輸入正確：resolve、移除 overlay、storage 標記 granted', async () => {
        const g = createAccessGate('1234', { storage })
        const p = g.ensureAccess()
        const input = document.querySelector('#access-gate-overlay input')
        const btn = document.querySelector('#access-gate-overlay button')
        input.value = '1234'
        btn.click()
        await p
        expect(g.isAccessGranted()).toBe(true)
        expect(storage.getItem('jijun_access_granted')).toBe('1')
        expect(document.getElementById('access-gate-overlay')).toBeNull()
    })

    it('已授權（storage 有標記）：立即 resolve、不渲染 overlay', async () => {
        storage.setItem('jijun_access_granted', '1')
        const g = createAccessGate('1234', { storage })
        await g.ensureAccess()
        expect(g.isAccessGranted()).toBe(true)
        expect(document.getElementById('access-gate-overlay')).toBeNull()
    })

    it('Enter 鍵也可解鎖', async () => {
        const g = createAccessGate('abc', { storage })
        const p = g.ensureAccess()
        const input = document.querySelector('#access-gate-overlay input')
        input.value = 'abc'
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
        await p
        expect(storage.getItem('jijun_access_granted')).toBe('1')
    })

    it('storage 為 null（不可用）時：未輸入前永不 resolve，輸入正確後本 session 放行', async () => {
        const g = createAccessGate('xyz', { storage: null })
        const p = g.ensureAccess()
        expect(g.isAccessGranted()).toBe(false)
        const input = document.querySelector('#access-gate-overlay input')
        const btn = document.querySelector('#access-gate-overlay button')
        input.value = 'xyz'
        btn.click()
        await p
        expect(g.isAccessGranted()).toBe(true)
    })
})
