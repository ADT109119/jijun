// 群組管理頁面
import { GroupManager } from '../groupManager.js'
import { formatCurrency, formatDate, formatDateToString, showToast, customConfirm, customAlert, escapeHTML } from '../utils.js'

export class GroupsPage {
    constructor(app) {
        this.app = app
        this.dataService = app.dataService
        this.groupManager = new GroupManager(app.dataService, app)
    }

    async render(params = null) {
        const container = this.app.appContainer
        const dataService = this.dataService
        const groupManager = this.groupManager
        const debtManager = this.app.debtManager

        const groups = await dataService.getGroups()
        const sortedGroups = [...groups].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))

        container.innerHTML = `
          <div class="page active p-4 pb-24 md:pb-8 max-w-3xl mx-auto">
            <!-- Header -->
            <div class="flex items-center justify-between mb-6">
              <a href="#settings" class="text-wabi-text-secondary hover:text-wabi-primary">
                <i class="fa-solid fa-chevron-left text-xl"></i>
              </a>
              <h1 class="text-xl font-bold text-wabi-primary">群組與專案管理</h1>
              <button id="add-group-btn" class="bg-wabi-primary text-wabi-surface rounded-full w-8 h-8 flex items-center justify-center shadow">
                <i class="fa-solid fa-plus"></i>
              </button>
            </div>

            <!-- Group List Container -->
            <div id="groups-list-container" class="space-y-3">
              ${sortedGroups.length === 0 ? `
                <div class="text-center py-12 text-wabi-text-secondary bg-wabi-surface rounded-xl border border-wabi-border p-6">
                  <i class="fa-solid fa-layer-group text-4xl mb-3 text-emerald-600/50"></i>
                  <p class="font-medium text-base text-wabi-text-primary">尚無任何群組或活動專案</p>
                  <p class="text-xs text-wabi-text-secondary mt-1 mb-4">您可以建立專案標籤群組，方便紀錄旅行、活動分帳或專案公款！</p>
                  <button id="add-first-group-btn" class="px-4 py-2 bg-wabi-primary text-wabi-surface text-sm font-medium rounded-lg shadow hover:opacity-90 transition-opacity">
                    建立第一個群組
                  </button>
                </div>
              ` : sortedGroups.map(group => {
                const netClass = group.netAmount < 0 ? 'text-wabi-income' : group.netAmount > 0 ? 'text-wabi-expense' : 'text-wabi-text-secondary';
                const netDirection = group.netAmount < 0 ? '待收款' : group.netAmount > 0 ? '待退款' : '已平衡';

                return `
                  <div class="group-page-card bg-wabi-surface rounded-xl border border-wabi-border p-4 shadow-sm hover:border-emerald-500/50 transition-colors" data-group-id="${group.id}">
                    <div class="flex items-start justify-between">
                      <div class="flex items-center gap-3">
                        <div class="flex items-center justify-center rounded-full bg-emerald-500/20 text-emerald-600 ring-2 ring-emerald-500 size-10 flex-shrink-0">
                          <i class="fa-solid fa-layer-group"></i>
                        </div>
                        <div>
                          <div class="flex items-center gap-2">
                            <p class="font-bold text-wabi-text-primary text-base">${escapeHTML(group.name)}</p>
                            ${group.settled ? `
                              <span class="text-[10px] bg-emerald-500/10 text-emerald-600 px-2 py-0.5 rounded-full font-medium">已結清</span>
                            ` : `
                              <span class="text-[10px] bg-wabi-primary/10 text-wabi-primary px-2 py-0.5 rounded-full font-medium">進行中</span>
                            `}
                          </div>
                          <p class="text-xs text-wabi-text-secondary mt-0.5">
                            ${group.recordCount} 筆交易 · ${group.dateFrom ? `${formatDate(group.dateFrom, 'short')} ~ ${formatDate(group.dateTo, 'short')}` : '尚未有紀錄'}
                          </p>
                        </div>
                      </div>
                      <div class="text-right">
                        <p class="font-bold ${netClass} text-base">${group.netAmount >= 0 ? '-' : '+'}${formatCurrency(Math.abs(group.netAmount))}</p>
                        <p class="text-xs text-wabi-text-secondary mt-0.5">${netDirection}</p>
                      </div>
                    </div>

                    <div class="flex items-center justify-between mt-3 pt-3 border-t border-wabi-border text-xs text-wabi-text-secondary">
                      <div>
                        總支出：<span class="font-medium text-wabi-expense">${formatCurrency(group.totalExpense)}</span> ｜ 
                        總收入：<span class="font-medium text-wabi-income">${formatCurrency(group.totalIncome)}</span>
                      </div>
                      <div class="flex gap-2">
                        <button class="view-group-detail-btn px-3 py-1.5 font-medium text-wabi-primary border border-wabi-primary/40 rounded-lg hover:bg-wabi-primary/5 transition-colors" data-id="${group.id}">
                          細節
                        </button>
                        <button class="rename-group-btn px-2.5 py-1.5 text-wabi-text-secondary hover:text-wabi-primary border border-wabi-border rounded-lg" data-id="${group.id}">
                          <i class="fa-solid fa-pen"></i>
                        </button>
                        <button class="delete-group-btn px-2.5 py-1.5 text-wabi-expense hover:bg-wabi-expense/10 border border-wabi-expense/30 rounded-lg" data-id="${group.id}">
                          <i class="fa-solid fa-trash"></i>
                        </button>
                      </div>
                    </div>
                  </div>
                `;
              }).join('')}
            </div>
          </div>
        `

        // 新增群組彈窗
        const showAddGroupModal = (groupToEdit = null) => {
            const isEdit = !!groupToEdit
            const modal = document.createElement('div')
            modal.className = 'fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4'
            modal.innerHTML = `
              <div class="bg-wabi-bg rounded-lg max-w-sm w-full p-6 shadow-xl">
                <h3 class="text-lg font-bold mb-4 text-wabi-primary">${isEdit ? '重命名群組' : '建立新群組 / 專案'}</h3>
                <div class="mb-5">
                  <label class="text-sm font-medium text-wabi-text-primary mb-2 block">群組名稱</label>
                  <input type="text" id="group-name-input" value="${escapeHTML(groupToEdit?.name || '')}" placeholder="例如：日本旅遊、辦公室團購、室友分帳"
                         class="w-full p-3 bg-wabi-surface border border-wabi-border rounded-lg text-wabi-text-primary focus:outline-none focus:border-wabi-primary">
                </div>
                <div class="flex space-x-3">
                  <button id="save-group-modal-btn" class="flex-1 bg-wabi-primary hover:opacity-90 text-wabi-surface font-bold py-3 rounded-lg transition-opacity">
                    ${isEdit ? '儲存' : '建立'}
                  </button>
                  <button id="cancel-group-modal-btn" class="px-6 bg-wabi-border text-wabi-text-primary py-3 rounded-lg hover:bg-wabi-border/80 transition-colors">
                    取消
                  </button>
                </div>
              </div>
            `
            document.body.appendChild(modal)

            const closeModal = () => modal.remove()
            modal.querySelector('#cancel-group-modal-btn').addEventListener('click', closeModal)
            modal.addEventListener('click', e => { if (e.target === modal) closeModal() })

            setTimeout(() => modal.querySelector('#group-name-input').focus(), 100)

            modal.querySelector('#save-group-modal-btn').addEventListener('click', async () => {
                const name = modal.querySelector('#group-name-input').value.trim()
                if (!name) {
                    customAlert('請輸入群組名稱')
                    return
                }
                if (isEdit) {
                    await groupManager.renameGroup(groupToEdit.id, name)
                    showToast('已更新群組名稱', 'success')
                } else {
                    await groupManager.createGroup(name)
                    showToast('已建立新群組', 'success')
                }
                closeModal()
                this.render(params)
            })
        }

        // 事件綁定
        container.querySelector('#add-group-btn')?.addEventListener('click', () => showAddGroupModal())
        container.querySelector('#add-first-group-btn')?.addEventListener('click', () => showAddGroupModal())

        container.querySelectorAll('.view-group-detail-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
                const groupId = btn.dataset.id
                if (debtManager) {
                    await debtManager.showGroupDetailsModal(groupId)
                }
            })
        })

        container.querySelectorAll('.rename-group-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
                const groupId = btn.dataset.id
                const groupMeta = await dataService.getGroupMeta(groupId)
                if (groupMeta) {
                    showAddGroupModal(groupMeta)
                }
            })
        })

        container.querySelectorAll('.delete-group-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
                const groupId = btn.dataset.id
                const groupMeta = await dataService.getGroupMeta(groupId)
                if (await customConfirm(`確定要刪除群組「${groupMeta?.name || ''}」嗎？群組刪除後，屬於該群組的記帳紀錄將不會被刪除，但會解除與群組的關聯。`)) {
                    await groupManager.deleteGroup(groupId)
                    showToast('已刪除群組', 'success')
                    this.render(params)
                }
            })
        })
    }
}
