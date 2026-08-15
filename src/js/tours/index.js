// tours/index.js — 導覽註冊表
// #U08 導覽功能 (Onboarding & Feature Tour)
// 匯入所有導覽配置，匯出統一 TOURS 註冊表供 TourManager 使用。
// 新增導覽：在此目錄新增配置文件 + 在此匯入註冊即可。
import { welcomeTour } from './welcomeTour.js'
import { basicGuideTour } from './basicGuideTour.js'
import { debtsTour } from './debtsTour.js'
import { accountsTour } from './accountsTour.js'
import { statisticsTour } from './statisticsTour.js'
import { recurringTour } from './recurringTour.js'
import { ledgersTour } from './ledgersTour.js'
import { groupsTour } from './groupsTour.js'
import { budgetTour } from './budgetTour.js'
import { amortizationsTour } from './amortizationsTour.js'
import { aiTour } from './aiTour.js'

export const TOURS = {
    welcome: welcomeTour,
    basics: basicGuideTour,
    debts: debtsTour,
    accounts: accountsTour,
    statistics: statisticsTour,
    recurring: recurringTour,
    ledgers: ledgersTour,
    groups: groupsTour,
    budget: budgetTour,
    amortizations: amortizationsTour,
    ai: aiTour,
}
