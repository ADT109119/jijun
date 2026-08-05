import { describe, it, expect, vi, beforeEach } from 'vitest'
import { GroupManager } from '../../src/js/groupManager.js'

// Mock utils
vi.mock('../../src/js/utils.js', () => ({
    formatCurrency: vi.fn((amount) => `$${amount}`),
    formatDate: vi.fn((date) => date),
    showToast: vi.fn(),
}))

describe('GroupManager', () => {
    let mockDataService
    let mockApp
    let gm

    beforeEach(() => {
        vi.clearAllMocks()

        mockDataService = {
            activeLedgerId: 1,
            saveGroupMeta: vi.fn(),
            deleteGroupMeta: vi.fn(),
            getGroupMeta: vi.fn(),
            getGroups: vi.fn(),
            getRecords: vi.fn(),
            updateRecord: vi.fn(),
            settleGroup: vi.fn(),
            partialSettleGroup: vi.fn(),
        }

        mockApp = {
            currentGroup: null,
            updateGroupList: vi.fn(),
        }

        gm = new GroupManager(mockDataService, mockApp)
    })

    describe('constructor', () => {
        it('儲存 dataService 和 app 引用', () => {
            expect(gm.dataService).toBe(mockDataService)
            expect(gm.appRef).toBe(mockApp)
        })

        it('appRef 可省略', () => {
            const gmNoApp = new GroupManager(mockDataService)
            expect(gmNoApp.dataService).toBe(mockDataService)
            expect(gmNoApp.appRef).toBeNull()
        })
    })

    describe('createGroup', () => {
        it('建立新群組並回傳 groupId', async () => {
            const fakeId = 'group-uuid-123'
            vi.spyOn(crypto, 'randomUUID').mockReturnValue(fakeId)

            const result = await gm.createGroup('聚餐')

            expect(result).toBe(fakeId)
            expect(mockDataService.saveGroupMeta).toHaveBeenCalledWith(
                expect.objectContaining({
                    id: fakeId,
                    name: '聚餐',
                    settled: false,
                    settledAt: null,
                    ledgerId: 1,
                })
            )
        })

        it('_trim_群組名稱', async () => {
            vi.spyOn(crypto, 'randomUUID').mockReturnValue('g1')

            await gm.createGroup('  旅行基金  ')

            const callArg = mockDataService.saveGroupMeta.mock.calls[0][0]
            expect(callArg.name).toBe('旅行基金')
        })

        it('指定 ledgerId 時使用指定值', async () => {
            vi.spyOn(crypto, 'randomUUID').mockReturnValue('g2')

            await gm.createGroup('公司聚餐', 5)

            const callArg = mockDataService.saveGroupMeta.mock.calls[0][0]
            expect(callArg.ledgerId).toBe(5)
        })

        it('未指定 ledgerId 時使用 activeLedgerId', async () => {
            vi.spyOn(crypto, 'randomUUID').mockReturnValue('g3')
            mockDataService.activeLedgerId = 99

            await gm.createGroup('個人聚餐')

            const callArg = mockDataService.saveGroupMeta.mock.calls[0][0]
            expect(callArg.ledgerId).toBe(99)
        })

        it('createdAt 為時間戳記', async () => {
            vi.spyOn(crypto, 'randomUUID').mockReturnValue('g4')

            await gm.createGroup('測試')

            const callArg = mockDataService.saveGroupMeta.mock.calls[0][0]
            expect(typeof callArg.createdAt).toBe('number')
            expect(callArg.createdAt).toBeGreaterThan(Date.now() - 5000)
        })
    })

    describe('deleteGroup', () => {
        it('呼叫 deleteGroupMeta 並回傳 true', async () => {
            const result = await gm.deleteGroup('g1')

            expect(result).toBe(true)
            expect(mockDataService.deleteGroupMeta).toHaveBeenCalledWith('g1')
        })
    })

    describe('renameGroup', () => {
        it('重命名成功回傳 true', async () => {
            const existingMeta = { id: 'g1', name: '舊名稱', settled: false }
            mockDataService.getGroupMeta.mockResolvedValue(existingMeta)

            const result = await gm.renameGroup('g1', '新名稱')

            expect(result).toBe(true)
            expect(mockDataService.saveGroupMeta).toHaveBeenCalledWith(
                expect.objectContaining({
                    id: 'g1',
                    name: '新名稱',
                })
            )
        })

        it('_trim_新名稱', async () => {
            const existingMeta = { id: 'g1', name: '舊', settled: false }
            mockDataService.getGroupMeta.mockResolvedValue(existingMeta)

            await gm.renameGroup('g1', '  修剪後  ')

            const callArg = mockDataService.saveGroupMeta.mock.calls[0][0]
            expect(callArg.name).toBe('修剪後')
        })

        it('群組不存在時回傳 false', async () => {
            mockDataService.getGroupMeta.mockResolvedValue(null)

            const result = await gm.renameGroup('nonexistent', '新名稱')

            expect(result).toBe(false)
            expect(mockDataService.saveGroupMeta).not.toHaveBeenCalled()
        })
    })

    describe('getUnsettledGroups', () => {
        it('只回傳未結清的群組', async () => {
            const groups = [
                { id: 'g1', name: '未結清', settled: false },
                { id: 'g2', name: '已結清', settled: true },
                { id: 'g3', name: '未結清2', settled: false },
            ]
            mockDataService.getGroups.mockResolvedValue(groups)

            const result = await gm.getUnsettledGroups()

            expect(result).toHaveLength(2)
            expect(result.every(g => !g.settled)).toBe(true)
            expect(result.map(g => g.name)).toEqual(['未結清', '未結清2'])
        })

        it('指定 ledgerId 時傳遞給 getGroups', async () => {
            mockDataService.getGroups.mockResolvedValue([])

            await gm.getUnsettledGroups(5)

            expect(mockDataService.getGroups).toHaveBeenCalledWith(5)
        })

        it('全為已結清時回傳空陣列', async () => {
            const groups = [
                { id: 'g1', settled: true },
                { id: 'g2', settled: true },
            ]
            mockDataService.getGroups.mockResolvedValue(groups)

            const result = await gm.getUnsettledGroups()

            expect(result).toEqual([])
        })
    })

    describe('getSettledGroups', () => {
        it('只回傳已結清的群組', async () => {
            const groups = [
                { id: 'g1', name: 'A', settled: true },
                { id: 'g2', name: 'B', settled: false },
                { id: 'g3', name: 'C', settled: true },
            ]
            mockDataService.getGroups.mockResolvedValue(groups)

            const result = await gm.getSettledGroups()

            expect(result).toHaveLength(2)
            expect(result.every(g => g.settled)).toBe(true)
        })

        it('指定 ledgerId 時傳遞給 getGroups', async () => {
            mockDataService.getGroups.mockResolvedValue([])

            await gm.getSettledGroups(3)

            expect(mockDataService.getGroups).toHaveBeenCalledWith(3)
        })
    })

    describe('getGroupSummary', () => {
        it('找到群組時回傳摘要', async () => {
            const groups = [
                { id: 'g1', name: '聚餐', total: 3000 },
                { id: 'g2', name: '旅行', total: 5000 },
            ]
            mockDataService.getGroups.mockResolvedValue(groups)

            const result = await gm.getGroupSummary('g2')

            expect(result).toEqual({ id: 'g2', name: '旅行', total: 5000 })
        })

        it('找不到群組時回傳 null', async () => {
            mockDataService.getGroups.mockResolvedValue([])

            const result = await gm.getGroupSummary('nonexistent')

            expect(result).toBeNull()
        })
    })

    describe('addRecordToGroup', () => {
        it('成功加入紀錄到群組', async () => {
            const meta = { id: 'g1', name: '聚餐', settled: false, ledgerId: 1 }
            mockDataService.getGroupMeta.mockResolvedValue(meta)

            const records = [
                { id: 101, type: 'expense', amount: 100, groupId: null },
                { id: 102, type: 'expense', amount: 200, groupId: null },
            ]
            mockDataService.getRecords.mockResolvedValue(records)

            const result = await gm.addRecordToGroup(102, 'g1')

            expect(result).toBe(true)
            expect(mockDataService.updateRecord).toHaveBeenCalledWith(
                expect.objectContaining({
                    id: 102,
                    groupId: 'g1',
                    groupStatus: 'active',
                    ledgerId: 1,
                })
            )
        })

        it('群組不存在時回傳 false', async () => {
            mockDataService.getGroupMeta.mockResolvedValue(null)

            const result = await gm.addRecordToGroup(1, 'nonexistent')

            expect(result).toBe(false)
            expect(mockDataService.updateRecord).not.toHaveBeenCalled()
        })

        it('已結清群組拒絕加入並顯示提示', async () => {
            const { showToast } = await import('../../src/js/utils.js')

            const meta = { id: 'g1', name: '聚餐', settled: true, ledgerId: 1 }
            mockDataService.getGroupMeta.mockResolvedValue(meta)

            const result = await gm.addRecordToGroup(1, 'g1')

            expect(result).toBe(false)
            expect(showToast).toHaveBeenCalledWith('已結清的群組無法加入新紀錄')
        })

        it('紀錄不存在時回傳 false', async () => {
            const meta = { id: 'g1', name: '聚餐', settled: false, ledgerId: 1 }
            mockDataService.getGroupMeta.mockResolvedValue(meta)
            mockDataService.getRecords.mockResolvedValue([
                { id: 101, type: 'expense', amount: 100 },
            ])

            const result = await gm.addRecordToGroup(999, 'g1')

            expect(result).toBe(false)
            expect(mockDataService.updateRecord).not.toHaveBeenCalled()
        })
    })

    describe('removeRecordFromGroup', () => {
        it('成功從群組移除紀錄', async () => {
            const records = [
                { id: 101, type: 'expense', amount: 100, groupId: 'g1', groupStatus: 'active' },
            ]
            mockDataService.getRecords.mockResolvedValue(records)

            const result = await gm.removeRecordFromGroup(101)

            expect(result).toBe(true)
            expect(mockDataService.updateRecord).toHaveBeenCalledWith(
                expect.objectContaining({
                    id: 101,
                    groupId: null,
                    groupStatus: null,
                })
            )
        })

        it('紀錄不存在時回傳 false', async () => {
            mockDataService.getRecords.mockResolvedValue([])

            const result = await gm.removeRecordFromGroup(999)

            expect(result).toBe(false)
            expect(mockDataService.updateRecord).not.toHaveBeenCalled()
        })

        it('紀錄不在群組中時回傳 false', async () => {
            const records = [
                { id: 101, type: 'expense', amount: 100, groupId: null },
            ]
            mockDataService.getRecords.mockResolvedValue(records)

            const result = await gm.removeRecordFromGroup(101)

            expect(result).toBe(false)
            expect(mockDataService.updateRecord).not.toHaveBeenCalled()
        })
    })

    describe('settleGroup', () => {
        it('代理呼叫 dataService.settleGroup', async () => {
            const settleResult = { recordId: 201, groupId: 'g1' }
            mockDataService.settleGroup.mockResolvedValue(settleResult)

            const result = await gm.settleGroup('g1', 3000, 1, '2024-06-15', '結清')

            expect(result).toEqual(settleResult)
            expect(mockDataService.settleGroup).toHaveBeenCalledWith(
                'g1', 3000, 1, '2024-06-15', '結清'
            )
        })

        it('settleAmount 可省略', async () => {
            mockDataService.settleGroup.mockResolvedValue({ ok: true })

            await gm.settleGroup('g1', undefined, 1, '2024-06-15', undefined)

            expect(mockDataService.settleGroup).toHaveBeenCalledWith(
                'g1', undefined, 1, '2024-06-15', undefined
            )
        })
    })

    describe('partialSettleGroup', () => {
        it('代理呼叫 dataService.partialSettleGroup', async () => {
            const settleResult = { recordId: 202, groupId: 'g1' }
            mockDataService.partialSettleGroup.mockResolvedValue(settleResult)

            const result = await gm.partialSettleGroup('g1', 1000, 1, '2024-06-15', '部分退款')

            expect(result).toEqual(settleResult)
            expect(mockDataService.partialSettleGroup).toHaveBeenCalledWith(
                'g1', 1000, 1, '2024-06-15', '部分退款'
            )
        })
    })
})