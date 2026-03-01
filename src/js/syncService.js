/**
 * SyncService — Google OAuth + Drive 備份 + 多裝置同步引擎
 *
 * 所有同步資料皆存放於 Google Drive appDataFolder，不使用外部 KV。
 * Worker 僅負責 OAuth token exchange（因 client_secret 不能暴露在前端）。
 */

import { showToast } from './utils.js';

/** @type {string} Google OAuth Client ID（在 Google Cloud Console 取得） */
const GOOGLE_CLIENT_ID = '350965300840-7eutjcl4jq930h5fjvoja4ho77q30cpp.apps.googleusercontent.com'; // 填入你的 Client ID

/** @type {string[]} Google Drive API 所需 scope */
const SCOPES = [
  'https://www.googleapis.com/auth/drive.appdata',
  'https://www.googleapis.com/auth/userinfo.profile',
  'https://www.googleapis.com/auth/userinfo.email',
];

/**
 * @class SyncService
 * @description 提供 Google OAuth 登入、Drive 備份、多裝置同步功能
 */
export class SyncService {
  /**
   * @param {import('./dataService.js').default} dataService
   */
  constructor(dataService) {
    /** @type {import('./dataService.js').default} */
    this.dataService = dataService;

    /** @type {string|null} */
    this.accessToken = null;

    /** @type {string|null} */
    this.refreshToken = null;

    /** @type {number|null} token 過期時間 (epoch ms) */
    this.tokenExpiresAt = null;

    /** @type {object|null} Google user profile */
    this.userInfo = null;

    /** @type {string} 同步/驗證伺服器 URL */
    this.serverUrl = 'https://jijun-server.the-walking-fish.com';

    /** @type {number|null} 自動同步 interval ID */
    this._autoSyncIntervalId = null;

    /** @type {number|null} 自動備份 interval ID */
    this._autoBackupIntervalId = null;

    /** @type {string} 裝置唯一 ID */
    this.deviceId = this.getDeviceId();

    /** @type {boolean} 是否正在同步中 */
    this._syncing = false;
  }

  // ──────────────────────────────────────────────
  // Initialization
  // ──────────────────────────────────────────────

  /**
   * 從 IndexedDB 還原已儲存的 token 和設定
   */
  async init() {
    try {
      const tokenData = await this.dataService.getSetting('sync_tokens');
      if (tokenData?.value) {
        this.accessToken = tokenData.value.access_token || null;
        this.refreshToken = tokenData.value.refresh_token || null;
        this.tokenExpiresAt = tokenData.value.expires_at || null;
        this.userInfo = tokenData.value.user_info || null;
      }

      const serverSetting = await this.dataService.getSetting('sync_server_url');
      if (serverSetting?.value) {
        this.serverUrl = serverSetting.value;
      }

      // 如果已登入且 token 快過期，嘗試刷新
      if (this.refreshToken && this.isTokenExpiringSoon()) {
        await this.refreshAccessToken();
      }

      // 檢查是否需要啟動自動同步
      const autoSyncSetting = await this.dataService.getSetting('sync_auto_enabled');
      if (autoSyncSetting?.value && this.isSignedIn()) {
        const intervalSetting = await this.dataService.getSetting('sync_auto_interval');
        const intervalMs = (intervalSetting?.value || 'daily') === 'daily'
          ? 24 * 60 * 60 * 1000
          : (intervalSetting?.value === 'weekly' ? 7 * 24 * 60 * 60 * 1000 : 30 * 24 * 60 * 60 * 1000);
        this.startAutoSync(intervalMs);
      }

      // 檢查是否需要啟動自動備份
      const autoBackupSetting = await this.dataService.getSetting('sync_auto_backup_enabled');
      if (autoBackupSetting?.value && this.isSignedIn()) {
        const backupIntervalSetting = await this.dataService.getSetting('sync_auto_backup_interval');
        const interval = backupIntervalSetting?.value || 'daily';
        this.startAutoBackup(interval);
      }
    } catch (err) {
      console.error('[SyncService] init error:', err);
    }
  }

  // ──────────────────────────────────────────────
  // Google OAuth
  // ──────────────────────────────────────────────

  /**
   * 是否已登入 Google
   * @returns {boolean}
   */
  isSignedIn() {
    return !!(this.accessToken && this.refreshToken);
  }

  /**
   * Token 是否即將過期（5 分鐘內）
   * @returns {boolean}
   */
  isTokenExpiringSoon() {
    if (!this.tokenExpiresAt) return true;
    return Date.now() > this.tokenExpiresAt - 5 * 60 * 1000;
  }

  /**
   * 確保有有效的 access token
   */
  async ensureValidToken() {
    if (this.isTokenExpiringSoon() && this.refreshToken) {
      await this.refreshAccessToken();
    }
    if (!this.accessToken) {
      throw new Error('Not signed in');
    }
  }

  /**
   * 使用 Google Identity Services 發起 OAuth 登入
   * @returns {Promise<boolean>} 是否登入成功
   */
  async signIn() {
    return new Promise((resolve, reject) => {
      if (!window.google?.accounts?.oauth2) {
        reject(new Error('Google Identity Services SDK 尚未載入'));
        return;
      }

      const client = window.google.accounts.oauth2.initCodeClient({
        client_id: GOOGLE_CLIENT_ID,
        scope: SCOPES.join(' '),
        ux_mode: 'popup',
        callback: async (response) => {
          if (response.error) {
            reject(new Error(response.error));
            return;
          }
          try {
            await this.handleAuthCallback(response.code);
            resolve(true);
          } catch (err) {
            reject(err);
          }
        },
      });

      client.requestCode();
    });
  }

  /**
   * 用 authorization code 透過 Worker 換取 tokens
   * @param {string} code  Authorization code from Google
   */
  async handleAuthCallback(code) {
    const serverUrl = this.serverUrl.replace(/\/+$/, '');
    const res = await fetch(`${serverUrl}/api/auth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, redirect_uri: 'postmessage' }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `Token exchange failed (${res.status})`);
    }

    const data = await res.json();
    this.accessToken = data.access_token;
    this.refreshToken = data.refresh_token;
    this.tokenExpiresAt = Date.now() + (data.expires_in || 3600) * 1000;

    // 取得使用者資訊
    await this.fetchUserInfo();

    // 儲存 tokens
    await this.saveTokens();
  }

  /**
   * 透過 Worker 刷新 access token
   */
  async refreshAccessToken() {
    if (!this.refreshToken) throw new Error('No refresh token');

    try {
      const serverUrl = this.serverUrl.replace(/\/+$/, '');
      const res = await fetch(`${serverUrl}/api/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: this.refreshToken }),
      });

      if (!res.ok) {
        // Refresh token 可能已失效，清除登入狀態
        if (res.status === 400 || res.status === 401) {
          await this.signOut();
          throw new Error('Session expired, please sign in again');
        }
        throw new Error(`Token refresh failed (${res.status})`);
      }

      const data = await res.json();
      this.accessToken = data.access_token;
      this.tokenExpiresAt = Date.now() + (data.expires_in || 3600) * 1000;
      await this.saveTokens();
    } catch (err) {
      console.error('[SyncService] refreshAccessToken error:', err);
      throw err;
    }
  }

  /**
   * 取得 Google 使用者資訊
   */
  async fetchUserInfo() {
    try {
      const res = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: { Authorization: `Bearer ${this.accessToken}` },
      });
      if (res.ok) {
        this.userInfo = await res.json();
      }
    } catch (err) {
      console.warn('[SyncService] fetchUserInfo error:', err);
    }
  }

  /**
   * 登出 — 清除所有 token 和狀態
   */
  async signOut() {
    this.accessToken = null;
    this.refreshToken = null;
    this.tokenExpiresAt = null;
    this.userInfo = null;
    this.stopAutoSync();
    this.stopAutoBackup();

    await this.dataService.saveSetting({ key: 'sync_tokens', value: null });
    await this.dataService.saveSetting({ key: 'sync_auto_enabled', value: false });
    await this.dataService.saveSetting({ key: 'sync_auto_backup_enabled', value: false });
  }

  /**
   * 儲存 token 到 IndexedDB
   */
  async saveTokens() {
    await this.dataService.saveSetting({
      key: 'sync_tokens',
      value: {
        access_token: this.accessToken,
        refresh_token: this.refreshToken,
        expires_at: this.tokenExpiresAt,
        user_info: this.userInfo,
      },
    });
  }

  // ──────────────────────────────────────────────
  // Server URL Management
  // ──────────────────────────────────────────────

  /**
   * 取得同步伺服器 URL
   * @returns {string}
   */
  getServerUrl() {
    return this.serverUrl;
  }

  /**
   * 設定同步伺服器 URL
   * @param {string} url
   */
  async setServerUrl(url) {
    this.serverUrl = url.replace(/\/+$/, '');
    await this.dataService.saveSetting({ key: 'sync_server_url', value: this.serverUrl });
  }

  // ──────────────────────────────────────────────
  // Google Drive — Backup
  // ──────────────────────────────────────────────

  /**
   * 備份資料到 Google Drive appDataFolder
   * @returns {Promise<object>} 備份檔案的 metadata
   */
  async backupToDrive() {
    await this.ensureValidToken();

    // 備份前先清理舊備份
    await this.cleanupOldBackups();

    const exportData = await this.dataService.exportDataForSync();
    exportData.backup_device = this.deviceId;
    exportData.backup_timestamp = Date.now();

    const fileName = `backup_${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    const fileContent = JSON.stringify(exportData);

    // 使用 multipart upload
    const metadata = {
      name: fileName,
      parents: ['appDataFolder'],
      mimeType: 'application/json',
    };

    const boundary = '-------314159265358979323846';
    const body = [
      `--${boundary}`,
      'Content-Type: application/json; charset=UTF-8',
      '',
      JSON.stringify(metadata),
      `--${boundary}`,
      'Content-Type: application/json',
      '',
      fileContent,
      `--${boundary}--`,
    ].join('\r\n');

    const res = await fetch(
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          'Content-Type': `multipart/related; boundary=${boundary}`,
        },
        body,
      }
    );

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error?.message || `Backup failed (${res.status})`);
    }

    // 記錄最後備份時間
    await this.dataService.saveSetting({
      key: 'sync_last_backup',
      value: { timestamp: Date.now(), fileName },
    });

    return await res.json();
  }

  /**
   * 列出所有備份檔案
   * @returns {Promise<Array>} 備份列表
   */
  async listBackups() {
    await this.ensureValidToken();

    const res = await fetch(
      `https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&q=name contains 'backup_'&fields=files(id,name,size,createdTime,modifiedTime)&orderBy=createdTime desc`,
      {
        headers: { Authorization: `Bearer ${this.accessToken}` },
      }
    );

    if (!res.ok) throw new Error(`Failed to list backups (${res.status})`);
    const data = await res.json();
    return data.files || [];
  }

  /**
   * 從 Google Drive 還原指定備份
   * @param {string} fileId  Drive file ID
   * @returns {Promise<object>} 備份資料
   */
  async restoreFromDrive(fileId) {
    await this.ensureValidToken();

    const res = await fetch(
      `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
      {
        headers: { Authorization: `Bearer ${this.accessToken}` },
      }
    );

    if (!res.ok) throw new Error(`Failed to download backup (${res.status})`);
    return await res.json();
  }

  /**
   * 刪除指定備份
   * @param {string} fileId  Drive file ID
   */
  async deleteBackup(fileId) {
    await this.ensureValidToken();

    const res = await fetch(
      `https://www.googleapis.com/drive/v3/files/${fileId}`,
      {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${this.accessToken}` },
      }
    );

    if (!res.ok && res.status !== 404) {
      throw new Error(`Failed to delete backup (${res.status})`);
    }
  }

  // ──────────────────────────────────────────────
  // Google Drive — Multi-device Sync
  // ──────────────────────────────────────────────

  /**
   * 將本地 change log 推送到 Google Drive
   */
  async pushChanges() {
    await this.ensureValidToken();

    const lastPush = await this.dataService.getSetting('sync_last_push_timestamp');
    const since = lastPush?.value || 0;
    const changes = await this.dataService.getChangesSince(since);

    if (changes.length === 0) return;

    const syncData = {
      deviceId: this.deviceId,
      timestamp: Date.now(),
      changes,
    };

    const fileName = `sync_log_${this.deviceId}.json`;

    // 先找到已存在的 sync log file
    const existingFileId = await this._findFile(fileName);

    if (existingFileId) {
      // 下載現有內容，合併後更新
      const existingData = await this._downloadFile(existingFileId);
      const existing = existingData || { changes: [] };
      existing.changes = [...(existing.changes || []), ...changes];
      existing.timestamp = Date.now();
      existing.deviceId = this.deviceId;

      await this._updateFile(existingFileId, JSON.stringify(existing));
    } else {
      // 建立新檔案
      await this._createFile(fileName, JSON.stringify(syncData));
    }

    // 記錄推送的最新時間
    const maxTimestamp = Math.max(...changes.map((c) => c.timestamp));
    await this.dataService.saveSetting({ key: 'sync_last_push_timestamp', value: maxTimestamp });
  }

  /**
   * 從 Google Drive 拉取其他裝置的變更並合併
   */
  async pullChanges() {
    await this.ensureValidToken();

    // 列出所有 sync log 檔案
    const res = await fetch(
      `https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&q=name contains 'sync_log_'&fields=files(id,name,modifiedTime)`,
      {
        headers: { Authorization: `Bearer ${this.accessToken}` },
      }
    );

    if (!res.ok) throw new Error(`Failed to list sync logs (${res.status})`);
    const data = await res.json();
    const files = data.files || [];

    const lastPull = await this.dataService.getSetting('sync_last_pull_timestamps');
    const pullTimestamps = lastPull?.value || {};

    const allRemoteChanges = [];

    for (const file of files) {
      // 跳過自己的 sync log
      if (file.name === `sync_log_${this.deviceId}.json`) continue;

      const lastPullTime = pullTimestamps[file.name] || 0;

      // 如果檔案在上次拉取後有修改
      if (new Date(file.modifiedTime).getTime() > lastPullTime) {
        const syncLog = await this._downloadFile(file.id);
        if (syncLog?.changes) {
          // 只取比上次拉取時間更新的變更
          const newChanges = syncLog.changes.filter(
            (c) => c.timestamp > lastPullTime
          );
          allRemoteChanges.push(...newChanges);
        }
        pullTimestamps[file.name] = Date.now();
      }
    }

    if (allRemoteChanges.length > 0) {
      // 按時間排序
      allRemoteChanges.sort((a, b) => a.timestamp - b.timestamp);
      await this.applyRemoteChanges(allRemoteChanges);
    }

    await this.dataService.saveSetting({
      key: 'sync_last_pull_timestamps',
      value: pullTimestamps,
    });

    // 記錄最後同步時間
    await this.dataService.saveSetting({
      key: 'sync_last_sync',
      value: Date.now(),
    });
  }

  /**
   * 合併遠端變更到本地 IndexedDB（Last-Write-Wins）
   * @param {Array} changes 變更列表
   */
  async applyRemoteChanges(changes) {
    for (const change of changes) {
      try {
        const { operation, storeName, recordId, data } = change;

        switch (operation) {
          case 'add':
            await this._applyAdd(storeName, data);
            break;
          case 'update':
            await this._applyUpdate(storeName, recordId, data);
            break;
          case 'delete':
            await this._applyDelete(storeName, recordId, data);
            break;
          default:
            console.warn('[SyncService] Unknown operation:', operation);
        }
      } catch (err) {
        console.error('[SyncService] Error applying change:', err, change);
      }
    }
  }

  /**
   * 標記所有遠端變更為已拉取（用於 Restore 後避免重複套用舊變更）
   */
  async markAllRemoteChangesAsPulled() {
    await this.ensureValidToken();
    try {
        const res = await fetch(
          `https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&q=name contains 'sync_log_'&fields=files(id,name,modifiedTime)`,
          { headers: { Authorization: `Bearer ${this.accessToken}` } }
        );
        if (!res.ok) throw new Error('Failed to list sync logs');
        const data = await res.json();
        const files = data.files || [];

        const lastPull = await this.dataService.getSetting('sync_last_pull_timestamps');
        const pullTimestamps = lastPull?.value || {};

        for (const file of files) {
            pullTimestamps[file.name] = new Date(file.modifiedTime).getTime();
        }

        await this.dataService.saveSetting({
            key: 'sync_last_pull_timestamps',
            value: pullTimestamps
        });
        console.log('[SyncService] Marked all remote changes as pulled.');
    } catch (err) {
        console.error('[SyncService] markAllRemoteChangesAsPulled error:', err);
    }
  }

  /**
   * 執行完整同步（push + pull）
   */
  async performSync() {
    if (this._syncing) return;
    this._syncing = true;

    try {
      await this.pushChanges();
      await this.pullChanges();
    } finally {
      this._syncing = false;
    }
  }

  // ────────────────────────────────────────────────
  // Backup Retention Policy
  // ────────────────────────────────────────────────

  /**
   * 清理舊備份：
   * - 近 7 天的備份全部保留
   * - 7 天以前、一年以內：每月僅保留第一筆
   * - 一年以前的全部刪除
   */
  async cleanupOldBackups() {
    try {
      const backups = await this.listBackups();
      if (backups.length === 0) return;

      const now = Date.now();
      const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;
      const ONE_YEAR = 365 * 24 * 60 * 60 * 1000;

      // 分類備份
      const toKeep = [];
      const toDelete = [];
      const monthlyBuckets = {}; // key: 'YYYY-MM', value: 該月最早的備份

      for (const backup of backups) {
        const createdAt = new Date(backup.createdTime).getTime();
        const age = now - createdAt;

        if (age <= SEVEN_DAYS) {
          // 近 7 天 → 全部保留
          toKeep.push(backup);
        } else if (age <= ONE_YEAR) {
          // 7天~1年 → 每月保留第一筆（最早的）
          const monthKey = new Date(backup.createdTime).toISOString().slice(0, 7); // 'YYYY-MM'
          if (!monthlyBuckets[monthKey]) {
            monthlyBuckets[monthKey] = { backup, createdAt };
          } else if (createdAt < monthlyBuckets[monthKey].createdAt) {
            // 這筆更早，替換為保留的，把舊的加到刪除列表
            toDelete.push(monthlyBuckets[monthKey].backup);
            monthlyBuckets[monthKey] = { backup, createdAt };
          } else {
            // 這筆更晚，刪除
            toDelete.push(backup);
          }
        } else {
          // 超過 1 年 → 刪除
          toDelete.push(backup);
        }
      }

      // 執行刪除
      for (const backup of toDelete) {
        try {
          await this.deleteBackup(backup.id);
          console.log(`[SyncService] Deleted old backup: ${backup.name}`);
        } catch (err) {
          console.warn(`[SyncService] Failed to delete backup ${backup.name}:`, err);
        }
      }

      if (toDelete.length > 0) {
        console.log(`[SyncService] Cleanup: deleted ${toDelete.length} old backups, kept ${toKeep.length + Object.keys(monthlyBuckets).length}`);
      }
    } catch (err) {
      console.error('[SyncService] cleanupOldBackups error:', err);
      // 清理失敗不應阻擋備份
    }
  }

  /**
   * 啟動自動同步
   * @param {number} intervalMs 同步間隔（毫秒）
   */
  startAutoSync(intervalMs) {
    this.stopAutoSync();

    // 啟動後立即同步一次
    this.performSync().catch((err) =>
      console.error('[SyncService] Auto sync error:', err)
    );

    this._autoSyncIntervalId = setInterval(() => {
      this.performSync().catch((err) =>
        console.error('[SyncService] Auto sync error:', err)
      );
    }, intervalMs);

    // 頁面 visibility 變化時也觸發同步
    this._visibilityHandler = () => {
      if (document.visibilityState === 'visible' && this.isSignedIn()) {
        this.performSync().catch((err) =>
          console.error('[SyncService] Visibility sync error:', err)
        );
      }
    };
    document.addEventListener('visibilitychange', this._visibilityHandler);
  }

  /**
   * 停止自動同步
   */
  stopAutoSync() {
    if (this._autoSyncIntervalId) {
      clearInterval(this._autoSyncIntervalId);
      this._autoSyncIntervalId = null;
    }
    if (this._visibilityHandler) {
      document.removeEventListener('visibilitychange', this._visibilityHandler);
      this._visibilityHandler = null;
    }
  }

  // ────────────────────────────────────────────────
  // Auto Backup
  // ────────────────────────────────────────────────

  /**
   * 啟動自動備份
   * @param {'daily'|'3days'|'weekly'} interval 備份間隔
   */
  startAutoBackup(interval = 'daily') {
    this.stopAutoBackup();

    const intervalMap = {
      daily: 24 * 60 * 60 * 1000,
      '3days': 3 * 24 * 60 * 60 * 1000,
      weekly: 7 * 24 * 60 * 60 * 1000,
    };
    const ms = intervalMap[interval] || intervalMap.daily;

    // 檢查是否需要立即備份（上次備份已過期）
    this._checkAndRunBackup(ms);

    this._autoBackupIntervalId = setInterval(() => {
      this._checkAndRunBackup(ms);
    }, 60 * 60 * 1000); // 每小時檢查一次是否到期
  }

  /**
   * 檢查是否需要執行自動備份
   * @param {number} intervalMs 備份間隔毫秒
   */
  async _checkAndRunBackup(intervalMs) {
    try {
      if (!this.isSignedIn()) return;

      const lastBackup = await this.dataService.getSetting('sync_last_backup');
      const lastTime = lastBackup?.value?.timestamp || 0;
      const elapsed = Date.now() - lastTime;

      if (elapsed >= intervalMs) {
        console.log('[SyncService] Auto backup triggered');
        await this.backupToDrive();
        console.log('[SyncService] Auto backup completed');
      }
    } catch (err) {
      console.error('[SyncService] Auto backup error:', err);
    }
  }

  /**
   * 停止自動備份
   */
  stopAutoBackup() {
    if (this._autoBackupIntervalId) {
      clearInterval(this._autoBackupIntervalId);
      this._autoBackupIntervalId = null;
    }
  }

  // ──────────────────────────────────────────────
  // Device ID
  // ──────────────────────────────────────────────

  /**
   * 取得或生成裝置唯一 ID
   * @returns {string}
   */
  getDeviceId() {
    let id = localStorage.getItem('sync_device_id');
    if (!id) {
      id = 'dev_' + Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 8);
      localStorage.setItem('sync_device_id', id);
    }
    return id;
  }

  // ──────────────────────────────────────────────
  // Google Drive Helpers
  // ──────────────────────────────────────────────

  /**
   * 在 appDataFolder 中搜尋指定名稱的檔案
   * @param {string} fileName
   * @returns {Promise<string|null>} file ID or null
   */
  async _findFile(fileName) {
    const res = await fetch(
      `https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&q=name='${fileName}'&fields=files(id)`,
      {
        headers: { Authorization: `Bearer ${this.accessToken}` },
      }
    );
    if (!res.ok) return null;
    const data = await res.json();
    return data.files?.[0]?.id || null;
  }

  /**
   * 下載檔案內容
   * @param {string} fileId
   * @returns {Promise<object|null>}
   */
  async _downloadFile(fileId) {
    const res = await fetch(
      `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
      {
        headers: { Authorization: `Bearer ${this.accessToken}` },
      }
    );
    if (!res.ok) return null;
    return await res.json();
  }

  /**
   * 建立新檔案到 appDataFolder
   * @param {string} fileName
   * @param {string} content
   * @returns {Promise<object>}
   */
  async _createFile(fileName, content) {
    const metadata = {
      name: fileName,
      parents: ['appDataFolder'],
      mimeType: 'application/json',
    };

    const boundary = '-------314159265358979323846';
    const body = [
      `--${boundary}`,
      'Content-Type: application/json; charset=UTF-8',
      '',
      JSON.stringify(metadata),
      `--${boundary}`,
      'Content-Type: application/json',
      '',
      content,
      `--${boundary}--`,
    ].join('\r\n');

    const res = await fetch(
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          'Content-Type': `multipart/related; boundary=${boundary}`,
        },
        body,
      }
    );

    if (!res.ok) throw new Error(`Failed to create file (${res.status})`);
    return await res.json();
  }

  /**
   * 更新既有檔案內容
   * @param {string} fileId
   * @param {string} content
   */
  async _updateFile(fileId, content) {
    const res = await fetch(
      `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`,
      {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: content,
      }
    );

    if (!res.ok) throw new Error(`Failed to update file (${res.status})`);
  }

  // ──────────────────────────────────────────────
  // Apply Remote Changes Helpers
  // ──────────────────────────────────────────────

  /**
   * @param {string} storeName
   * @param {object} data
   */
  async _applyAdd(storeName, data) {
    // Check duplication by UUID
    if (data.uuid) {
        const existing = await this.dataService.getByUUID(storeName, data.uuid);
        if (existing) {
            // If exists, treat as update to avoid duplicate
            await this._applyUpdateWithId(storeName, existing.id, data);
            return;
        }
    }

    switch (storeName) {
      case 'records':
        await this.dataService.addRecord(data, true);
        break;
      case 'accounts':
        await this.dataService.addAccount(data, true);
        break;
      case 'contacts':
        await this.dataService.addContact(data, true);
        break;
      case 'debts':
        await this.dataService.addDebt(data, true);
        break;
      default:
        console.warn('[SyncService] Unknown store for add:', storeName);
    }
  }

  /**
   * @param {string} storeName
   * @param {number|string} recordId
   * @param {object} data
   */
  async _applyUpdate(storeName, recordId, data) {
    // Try to find by UUID first
    if (data.uuid) {
        const existing = await this.dataService.getByUUID(storeName, data.uuid);
        if (existing) {
            await this._applyUpdateWithId(storeName, existing.id, data);
            return;
        } else {
            // Not found by UUID, treat as Add (upsert)
            await this._applyAdd(storeName, data);
            return;
        }
    }

    // Legacy fallback (might fail or duplicate if ID mismatches, but unavoidable without UUID)
    console.warn('[SyncService] Legacy update without UUID ignored:', storeName);
  }

  async _applyUpdateWithId(storeName, id, data) {
    switch (storeName) {
        case 'records':
          await this.dataService.updateRecord(id, data, true);
          break;
        case 'accounts':
          await this.dataService.updateAccount(id, data, true);
          break;
        case 'contacts':
          await this.dataService.updateContact(id, data, true);
          break;
        case 'debts':
          await this.dataService.updateDebt(id, data, true);
          break;
        default:
          console.warn('[SyncService] Unknown store for update:', storeName);
      }
  }

  /**
   * @param {string} storeName
   * @param {number|string} recordId
   * @param {object} data (Optional, may contain UUID)
   */
  async _applyDelete(storeName, recordId, data) {
    // Try to find by UUID
    if (data && data.uuid) {
        const existing = await this.dataService.getByUUID(storeName, data.uuid);
        if (existing) {
            await this._applyDeleteWithId(storeName, existing.id);
            return;
        } else {
            // Not found, maybe already deleted
            return;
        }
    }

    // Legacy fallback
    console.warn('[SyncService] Legacy delete without UUID ignored:', storeName);
  }

  async _applyDeleteWithId(storeName, id) {
    switch (storeName) {
        case 'records':
          await this.dataService.deleteRecord(id, true);
          break;
        case 'accounts':
          await this.dataService.deleteAccount(id, true);
          break;
        case 'contacts':
          await this.dataService.deleteContact(id, true);
          break;
        case 'debts':
          await this.dataService.deleteDebt(id, true);
          break;
        default:
          console.warn('[SyncService] Unknown store for delete:', storeName);
      }
  }
}

export default SyncService;
