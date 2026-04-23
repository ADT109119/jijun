import DataService from './dataService.js'

export class NotificationService {
  constructor(dataService) {
    this.dataService = dataService
    this.isNative = !!(window.Capacitor && window.Capacitor.isNative)
    this.hasPermission = false

    // Notification channel ID for Android
    this.channelId = 'easy_accounting_reminders'
  }

  async init() {
    await this.checkPermission()

    if (this.isNative) {
      try {
        const { LocalNotifications } = await import(
          '@capacitor/local-notifications'
        )
        // Create channel for Android 8.0+
        await LocalNotifications.createChannel({
          id: this.channelId,
          name: '記帳提醒',
          description: '每日定時記帳提醒',
          importance: 4, // High importance
          visibility: 1, // Public
        })
      } catch (e) {
        console.warn(
          '[NotificationService] Failed to initialize native notifications:',
          e
        )
      }
    } else {
      // Web init (requesting permission if not already granted/denied)
      if ('Notification' in window && Notification.permission === 'granted') {
        this.hasPermission = true
      }
    }

    // Check if we need to reschedule based on current settings
    await this.applyCurrentSettings()
  }

  async checkPermission() {
    if (this.isNative) {
      try {
        const { LocalNotifications } = await import(
          '@capacitor/local-notifications'
        )
        const permStatus = await LocalNotifications.checkPermissions()
        this.hasPermission = permStatus.display === 'granted'
      } catch (e) {
        console.warn('[NotificationService] checkPermissions error:', e)
        this.hasPermission = false
      }
    } else {
      this.hasPermission =
        'Notification' in window && Notification.permission === 'granted'
    }
    return this.hasPermission
  }

  async requestPermission() {
    if (this.isNative) {
      try {
        const { LocalNotifications } = await import(
          '@capacitor/local-notifications'
        )
        const permStatus = await LocalNotifications.requestPermissions()
        this.hasPermission = permStatus.display === 'granted'
      } catch (e) {
        console.error('[NotificationService] requestPermissions error:', e)
        this.hasPermission = false
      }
    } else {
      if (!('Notification' in window)) {
        console.warn('此瀏覽器不支援網頁推播通知')
        return false
      }
      const permission = await Notification.requestPermission()
      this.hasPermission = permission === 'granted'
    }
    return this.hasPermission
  }

  async applyCurrentSettings() {
    const enabledSetting = await this.dataService.getSetting('reminderEnabled')
    const timeSetting = await this.dataService.getSetting('reminderTime')
    const conditionSetting =
      await this.dataService.getSetting('reminderCondition')

    const enabled = enabledSetting?.value || false
    const timeStr = timeSetting?.value || '20:00' // Default 8 PM
    const condition = conditionSetting?.value || 'no_records' // Default to no records today

    if (!enabled) {
      await this.cancelReminder()
      return
    }

    if (!this.hasPermission) {
      // Cannot schedule if no permission yet.
      return
    }

    await this.scheduleReminder(timeStr, condition)
  }

  /**
   * Schedules a daily reminder.
   * @param {string} timeStr - "HH:mm" format (e.g. "20:30")
   * @param {string} condition - "always" or "no_records"
   * @param {boolean} skipToday - if true, schedule starts tomorrow even if today's time hasn't passed
   */
  async scheduleReminder(timeStr, condition, skipToday = false) {
    if (!this.hasPermission) return

    await this.cancelReminder() // Clear existing

    const [hours, minutes] = timeStr.split(':').map(Number)
    if (isNaN(hours) || isNaN(minutes)) return

    // Calculate next trigger time
    const now = new Date()
    const triggerDate = new Date()
    triggerDate.setHours(hours, minutes, 0, 0)

    // If time has passed today, or skipToday is true, schedule for tomorrow
    if (skipToday || now.getTime() > triggerDate.getTime()) {
      triggerDate.setDate(triggerDate.getDate() + 1)
    }

    const notificationId = 1001
    const title = '記帳提醒'
    const body = '今天還記得記帳嗎？點擊馬上紀錄！'

    if (this.isNative) {
      try {
        const { LocalNotifications } = await import(
          '@capacitor/local-notifications'
        )
        await LocalNotifications.schedule({
          notifications: [
            {
              id: notificationId,
              title: title,
              body: body,
              channelId: this.channelId,
              schedule: {
                on: { hour: hours, minute: minutes },
                allowWhileIdle: true,
              },
              smallIcon: 'ic_stat_icon', // Make sure to define in res/drawable if using Android
            },
          ],
        })
        console.log(
          '[NotificationService] Native reminder scheduled for daily at',
          timeStr
        )
      } catch (e) {
        console.error(
          '[NotificationService] Failed to schedule native notification:',
          e
        )
      }
    } else {
      // Web PWA Scheduling
      // We will pass the scheduling request to the ServiceWorker
      if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
        navigator.serviceWorker.controller.postMessage({
          type: 'SCHEDULE_REMINDER',
          payload: {
            title,
            body,
            timestamp: triggerDate.getTime(),
            timeStr, // Send time string so SW can easily calculate next day
          },
        })
        console.log(
          '[NotificationService] Web reminder scheduled via ServiceWorker for',
          triggerDate.toLocaleString()
        )
      } else {
        console.warn(
          '[NotificationService] ServiceWorker not active, cannot schedule web notification reliably.'
        )
      }
    }
  }

  async cancelReminder() {
    if (this.isNative) {
      try {
        const { LocalNotifications } = await import(
          '@capacitor/local-notifications'
        )
        await LocalNotifications.cancel({ notifications: [{ id: 1001 }] })
      } catch (e) {
        console.warn(
          '[NotificationService] Failed to cancel native notification:',
          e
        )
      }
    } else {
      if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
        navigator.serviceWorker.controller.postMessage({
          type: 'CANCEL_REMINDER',
        })
      }
    }
  }

  /**
   * Called when a record is added.
   * Checks if we need to defer the reminder to tomorrow based on settings.
   */
  async handleRecordAdded() {
    const enabledSetting = await this.dataService.getSetting('reminderEnabled')
    const conditionSetting =
      await this.dataService.getSetting('reminderCondition')
    const timeSetting = await this.dataService.getSetting('reminderTime')

    if (enabledSetting?.value && conditionSetting?.value === 'no_records') {
      // User added a record today. Skip today's reminder and schedule for tomorrow.
      const timeStr = timeSetting?.value || '20:00'
      await this.scheduleReminder(timeStr, 'no_records', true)
      console.log(
        '[NotificationService] Record added, reminder deferred to tomorrow due to "no_records" condition.'
      )
    }
  }
}
