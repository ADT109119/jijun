/**
 * SyncService — Google OAuth + Drive 備份 + 多裝置同步引擎
 *
 * 所有同步資料皆存放於 Google Drive appDataFolder，不使用外部 KV。
 * Worker 僅負責 OAuth token exchange（因 client_secret 不能暴露在前端）。
 */

import { showToast } from './utils.js';

/** @type {string} Google OAuth Client ID（在 Google Cloud Console 取得） */
const GOOGLE_CLIENT_ID = '350965300840-7eutjcl4jq930h5fjvoja4ho77q30cpp.apps.googleusercontent.com'; // 填入你的 Client ID

/** @type {string} Google API Key（供 Google Picker 使用，請在 Google Cloud Console 產生 API 金鑰） */
const GOOGLE_API_KEY = 'AIzaSyDcTWTpa2OGfX0IcOpcOTP2GTpPa8Za0fw'; // 填入您的 API Key

/** @type {string[]} Google Drive API 所需 scope */
const SCOPES = [
  'https://www.googleapis.com/auth/drive.appdata',
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/userinfo.profile',
  'https://www.googleapis.com/auth/userinfo.email',
];

/**
 * @class SyncService
 * @description 提供 Google OAuth 登入、Drive 備份、多裝置同步功能
 */

const isNative = typeof window !== 'undefined'
    && window.Capacitor?.isNativePlatform?.() === true;

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
      const isAutoSyncEnabled = autoSyncSetting?.value || false;
      const ledgers = await this.dataService.getLedgers();
      const hasShared = ledgers.some(l => l.isShared);
      
      if ((isAutoSyncEnabled || hasShared) && this.isSignedIn()) {
        this.startAutoSync();
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
   * 使用 Google Identity Services (Web) 或 GoogleAuth (Native) 發起 OAuth 登入
   * @returns {Promise<boolean>} 是否登入成功
   */
  async signIn() {
    if (isNative) {
      return this._signInNative();
    }
    return this._signInWeb();
  }

  /**
   * 原生 App 登入：使用 @codetrix-studio/capacitor-google-auth
   */
  async _signInNative() {
    try {
      const { GoogleAuth } = await import('@codetrix-studio/capacitor-google-auth');
      await GoogleAuth.initialize(); // Initialize plugin
      const result = await GoogleAuth.signIn();

      if (!result.serverAuthCode) {
        throw new Error('未取得 serverAuthCode (請確認 Google Cloud Console 設定了正確的 Web Client ID 且 forceCodeForRefreshToken為true)');
      }

      await this.handleAuthCallback(result.serverAuthCode);
      return true;
    } catch (e) {
      console.error('[SyncService] Native signIn error:', e);
      throw new Error('原生 Google 登入失敗: ' + (e.message || JSON.stringify(e)));
    }
  }

  /**
   * Web 登入：使用 Google Identity Services SDK
   */
  async _signInWeb() {
    return new Promise((resolve, reject) => {
      if (!window.google?.accounts?.oauth2) {
        reject(new Error('Google Identity Services SDK 尚未載入 (WebView 中不支援此方式)'));
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
    // 呼叫原生登出
    if (isNative) {
      try {
        const { GoogleAuth } = await import('@codetrix-studio/capacitor-google-auth');
        await GoogleAuth.signOut();
      } catch (e) {
        console.warn('[SyncService] Native signOut error:', e);
      }
    }

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

    // ============================================
    // 緊急補丁：修復因之前的過濾 bug 而遺失在 personal sync 中的 shared ledger 狀態
    const patchedFlag = await this.dataService.getSetting('repair_shared_sync_done');
    if (!patchedFlag || !patchedFlag.value) {
        const ledgers = await this.dataService.getLedgers();
        const sharedLedgers = ledgers.filter(l => l.isShared);
        
        if (sharedLedgers.length > 0) {
            for (const l of sharedLedgers) {
                // 確保目前批次內沒有重複
                const hasUpdate = changes.some(c => c.storeName === 'ledgers' && c.recordId === l.id && c.operation === 'update');
                if (!hasUpdate) {
                    changes.push({
                        deviceId: this.deviceId,
                        operation: 'update',
                        storeName: 'ledgers',
                        recordId: l.id,
                        timestamp: Date.now(),
                        data: l
                    });
                }
            }
        }
        await this.dataService.saveSetting({ key: 'repair_shared_sync_done', value: true });
    }
    // ============================================

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
      const res = await this._downloadFile(existingFileId);
      const existing = res?.data || { changes: [] };
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
    const resList = await fetch(
      `https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&q=name contains 'sync_log_'&fields=files(id,name,modifiedTime)`,
      {
        headers: { Authorization: `Bearer ${this.accessToken}` },
      }
    );

    if (!resList.ok) throw new Error(`Failed to list sync logs (${resList.status})`);
    const data = await resList.json();
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
        const resFile = await this._downloadFile(file.id);
        const syncLog = resFile?.data;
        if (syncLog?.changes) {
          // 只取比上次拉取時間更新的變更
          const newChanges = syncLog.changes.filter(
            (c) => c.timestamp >= lastPullTime
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
   * 合併遠端變更到本地 IndexedDB
   * @param {Array} changes 變更列表
   */
  async applyRemoteChanges(changes) {
    if (!changes || changes.length === 0) return;

    // 定義建立依賴的拓撲順序
    const topoOrder = ['custom_categories', 'ledgers', 'accounts', 'contacts', 'records', 'debts', 'recurring_transactions'];

    // 嚴格排序邏輯：
    // 1. 主要依據 timestamp (由舊到新)
    // 2. 若 timestamp 相同，則依據操作類型 (add > update > delete)
    // 3. 若操作類型也相同，則依據 topoOrder
    const sortedChanges = [...changes].sort((a, b) => {
        if (a.timestamp !== b.timestamp) {
            return a.timestamp - b.timestamp;
        }
        
        const opWeight = { 'add': 0, 'update': 1, 'delete': 2 };
        if (a.operation !== b.operation) {
            return opWeight[a.operation] - opWeight[b.operation];
        }

        const orderA = topoOrder.indexOf(a.storeName);
        const orderB = topoOrder.indexOf(b.storeName);
        return orderA - orderB;
    });

    for (const change of sortedChanges) {
      try {
        const { operation, storeName, recordId, data } = change;
        console.log(`[SyncService] applyRemoteChange: ${operation} ${storeName}`, data?.uuid || data?.name || recordId);
        
        // 預檢測：如果是 add 且 UUID 已存在，自動轉向 update，避免 Unique Constraint 失敗導致同步中斷
        if (operation === 'add' && data.uuid) {
            const existing = await this.dataService.getByUUID(storeName, data.uuid);
            if (existing) {
                await this._applyUpdateWithId(storeName, existing.id, data);
                continue;
            }
        }

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
        const resList = await fetch(
          `https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&q=name contains 'sync_log_'&fields=files(id,name,modifiedTime)`,
          { headers: { Authorization: `Bearer ${this.accessToken}` } }
        );
        if (!resList.ok) throw new Error('Failed to list sync logs');
        const data = await resList.json();
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
   * 將共用帳本的本地變更推送到各自的 Drive 共享檔案
   */
  async pushSharedLedgerChanges() {
    await this.ensureValidToken();

    const ledgers = await this.dataService.getLedgers();
    console.log('[SyncService] pushShared: all ledgers =', JSON.stringify(ledgers.map(l => ({ id: l.id, name: l.name, isShared: l.isShared, sharedFileId: l.sharedFileId, type: l.type }))));
    const sharedLedgers = ledgers.filter(l => l.isShared && l.sharedFileId);
    console.log('[SyncService] pushShared: filtered =', sharedLedgers.length, sharedLedgers.map(l => l.name));

    for (const ledger of sharedLedgers) {
      try {
        // ==================== 完整比對式推送 ====================
        // 核心理念：不依賴 lastPushTimestamp，每次都比對「本地所有日誌」vs「雲端日誌」
        // 如果本地有但雲端沒有 → 推送上去
        // 好處：即使被其他裝置覆蓋，下次同步一定會發現缺漏並自動補回

        // 1. 取得本機對此共用帳本的「全部」變更日誌
        const allLocalChanges = await this.dataService.getChangesSince(0, { sharedLedgerUuid: ledger.uuid });
        if (allLocalChanges.length === 0) continue;

        // 2. 下載雲端目前版本
        const resFile = await this._downloadFile(ledger.sharedFileId);
        if (!resFile) {
          console.warn(`[SyncService] pushShared: 無法下載 "${ledger.name}" 的雲端檔案，略過`);
          continue;
        }
        
        const cloudData = resFile.data || { changes: [] };
        const cloudChanges = cloudData.changes || [];
        
        // 3. 建立雲端日誌鍵集合
        const cloudKeySet = new Set();
        cloudChanges.forEach(log => {
            const key = `${log.deviceId || 'unknown'}|${log.timestamp}|${log.operation}|${log.storeName}`;
            cloudKeySet.add(key);
        });

        // 4. 找出「本地有但雲端沒有」的日誌
        const myMissingChanges = allLocalChanges
          .map(log => ({ ...log, deviceId: this.deviceId }))
          .filter(log => {
              const key = `${this.deviceId}|${log.timestamp}|${log.operation}|${log.storeName}`;
              return !cloudKeySet.has(key);
          });

        if (myMissingChanges.length === 0) {
          console.log(`[SyncService] pushShared: "${ledger.name}" 已完全同步，無需推送`);
          continue;
        }

        // 5. 合併並上傳
        cloudData.changes = [...cloudChanges, ...myMissingChanges];
        cloudData.timestamp = Date.now();
        cloudData.deviceId = this.deviceId;
        
        await this._updateFile(ledger.sharedFileId, JSON.stringify(cloudData));
        console.log(`[SyncService] pushShared: "${ledger.name}" 推送了 ${myMissingChanges.length} 筆變更`);

      } catch (e) {
        console.error(`[SyncService] pushSharedLedgerChanges failed for "${ledger.name}":`, e.message);
      }
    }
  }

  /**
   * 從各個共用帳本檔案拉取遠端變更（完整比對式）
   */
  async pullSharedLedgerChanges() {
    await this.ensureValidToken();

    const ledgers = await this.dataService.getLedgers();
    const sharedLedgers = ledgers.filter(l => l.isShared && l.sharedFileId);

    // 讀取「已套用過的遠端日誌鍵」集合，避免重複 apply
    const appliedKeysSetting = await this.dataService.getSetting('sync_shared_applied_keys');
    const appliedKeys = new Set(appliedKeysSetting?.value || []);
    const allRemoteChanges = [];

    for (const ledger of sharedLedgers) {
      try {
        const resFile = await this._downloadFile(ledger.sharedFileId);
        const fileData = resFile?.data;
        if (!fileData?.changes) continue;

        // 從雲端日誌中找出「不是自己推的」且「尚未套用過」的變更
        for (const change of fileData.changes) {
          if (change.deviceId === this.deviceId) continue; // 自己推的，略過
          const key = `${change.deviceId || 'unknown'}|${change.timestamp}|${change.operation}|${change.storeName}`;
          if (appliedKeys.has(key)) continue; // 已套用過，略過
          allRemoteChanges.push(change);
          appliedKeys.add(key); // 標記為已套用
        }
      } catch (e) {
        console.warn(`[SyncService] pullSharedLedgerChanges failed for ledger ${ledger.name}:`, e);
      }
    }

    if (allRemoteChanges.length > 0) {
      console.log(`[SyncService] pullShared: 收到 ${allRemoteChanges.length} 筆遠端變更，準備套用...`);
      allRemoteChanges.sort((a, b) => a.timestamp - b.timestamp);
      await this.applyRemoteChanges(allRemoteChanges);
    }

    // 持久化已套用鍵集合（轉為 Array 存入 settings）
    // 為避免無限增長，只保留最近 30 天的鍵
    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const trimmedKeys = [...appliedKeys].filter(key => {
        const ts = parseInt(key.split('|')[1], 10);
        return !isNaN(ts) && ts > thirtyDaysAgo;
    });
    await this.dataService.saveSetting({ key: 'sync_shared_applied_keys', value: trimmedKeys });
  }

  /**
   * 執行完整同步（push + pull + shared）
   * @param {boolean} isManual 是否為手動觸發（忽略個人同步的關閉設定）
   */
  async performSync(isManual = false) {
    if (this._syncing) return;
    this._syncing = true;

    try {
      const autoSyncSetting = await this.dataService.getSetting('sync_auto_enabled');
      const isPersonalEnabled = isManual || !!(autoSyncSetting?.value);

      console.log('[SyncService] performSync start', { isManual, isPersonalEnabled });

      if (isPersonalEnabled) await this.pushChanges();
      await this.pushSharedLedgerChanges();
      
      if (isPersonalEnabled) await this.pullChanges();
      await this.pullSharedLedgerChanges();

      console.log('[SyncService] performSync complete');
    } finally {
      this._syncing = false;
    }
  }

  /**
   * 確保共用帳本的自動同步已啟動（在加入/建立共用帳本後呼叫）
   */
  async ensureSharedSync() {
    if (!this.isSignedIn()) return;
    this.startAutoSync();
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
   * 啟動自動同步（僅在開啟時和回到前景時觸發，避免持續消耗流量）
   */
  startAutoSync() {
    this.stopAutoSync();

    // 啟動後立即同步一次
    this.performSync(false).catch((err) =>
      console.error('[SyncService] Auto sync error:', err)
    );

    // 頁面回到前景時觸發同步（例如切換 APP、鎖螢幕後回來）
    this._visibilityHandler = () => {
      if (document.visibilityState === 'visible' && this.isSignedIn()) {
        this.performSync(false).catch((err) =>
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
   * 刪除 Google Drive 上的檔案
   * @param {string} fileId
   */
  async deleteFile(fileId) {
    await this.ensureValidToken();
    const res = await fetch(
      `https://www.googleapis.com/drive/v3/files/${fileId}`,
      {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${this.accessToken}` },
      }
    );
    if (!res.ok && res.status !== 404) {
      throw new Error(`刪除檔案失敗 (${res.status})`);
    }
  }

  /**
   * 下載檔案內容
   * @param {string} fileId
   * @returns {Promise<{data: object, etag: string}|null>}
   */
  async _downloadFile(fileId) {
    const res = await fetch(
      `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
      {
        headers: { Authorization: `Bearer ${this.accessToken}` },
      }
    );
    if (!res.ok) return null;
    const data = await res.json();
    return { data };
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
   * 建立共用檔案到外部 (Drive Root)
   * @param {string} fileName
   * @param {string} content
   * @returns {Promise<object>}
   */
  async _createSharedFile(fileName, content) {
    const metadata = {
      name: fileName,
      // 不指定 parents，預設放在使用者的根目錄
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

    if (!res.ok) throw new Error(`Failed to create shared file (${res.status})`);
    return await res.json();
  }

  /**
   * 將指定檔案授權給其他 Email (Writer)
   * @param {string} fileId
   * @param {string} emailAddress
   */
  async grantFilePermission(fileId, emailAddress) {
    await this.ensureValidToken();

    const body = {
        role: 'writer',
        type: 'user',
        emailAddress: emailAddress
    };

    const res = await fetch(
        `https://www.googleapis.com/drive/v3/files/${fileId}/permissions?sendNotificationEmail=false`,
        {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${this.accessToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(body)
        }
    );

    if (!res.ok) {
        let errStr = '';
        try {
            const errJson = await res.json();
            errStr = errJson.error?.message || '';
        } catch(e) {}
        throw new Error(`Failed to grant permission (${res.status}): ${errStr}`);
    }
    return await res.json();
  }

  /**
   * 拿取檔案目前的權限清單
   * @param {string} fileId
   * @returns {Promise<Array>}
   */
  async getFilePermissions(fileId) {
    await this.ensureValidToken();
    const res = await fetch(
      `https://www.googleapis.com/drive/v3/files/${fileId}/permissions?fields=permissions(id,type,emailAddress,role,displayName)`,
      { headers: { Authorization: `Bearer ${this.accessToken}` } }
    );
    if (!res.ok) throw new Error('Failed to get permissions');
    const data = await res.json();
    return data.permissions;
  }

  /**
   * 移除檔案分享權限
   * @param {string} fileId
   * @param {string} permissionId
   */
  async removeFilePermission(fileId, permissionId) {
    await this.ensureValidToken();
    const res = await fetch(
      `https://www.googleapis.com/drive/v3/files/${fileId}/permissions/${permissionId}`,
      {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${this.accessToken}` }
      }
    );
    if (!res.ok) throw new Error('Failed to remove permission');
  }

  /**
   * 更新既有檔案內容
   * @param {string} fileId
   * @param {string} content
   * @param {string|null} matchTag - 用於樂觀鎖的 ETag
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
    if (!res.ok) {
      let errMsg = `Failed to update file (${res.status})`;
      try { const j = await res.json(); errMsg += ': ' + (j.error?.message || ''); } catch(_) {}
      console.error('[SyncService] _updateFile error:', errMsg);
      throw new Error(errMsg);
    }
  }

  // ──────────────────────────────────────────────
  // Apply Remote Changes — UUID Resolve Helpers
  // ──────────────────────────────────────────────

  /**
   * 將遠端 debt 的 contactUuid 解析為本地 contactId。
   * @param {object} data
   * @returns {object} 已修正 contactId 的 data
   */
  async _resolveDebtContactId(data) {
    if (!data.contactUuid) return data;
    try {
      const contacts = await this.dataService.getContacts();
      const matched = contacts.find(c => c.uuid === data.contactUuid);
      return { ...data, contactId: matched ? matched.id : null };
    } catch (_) {
      return data;
    }
  }

  /**
   * 將遠端 debt 的 recordUuid 解析為本地 recordId。
   * @param {object} data
   * @returns {object} 已修正 recordId 的 data
   */
  async _resolveDebtRecordId(data) {
    if (!data.recordUuid) return data;
    try {
      const rec = await this.dataService.getByUUID('records', data.recordUuid);
      return { ...data, recordId: rec ? rec.id : null };
    } catch (_) {
      return data;
    }
  }

  /**
   * 將遠端 debt 的 payments 陣列內的 recordUuid 解析為本地 recordId。
   * @param {object} data
   * @returns {object} 已修正 payments 內 recordId 的 data
   */
  async _resolveDebtPayments(data) {
    if (!data.payments || !Array.isArray(data.payments)) return data;
    try {
      const newPayments = [];
      for (const p of data.payments) {
        if (p.recordUuid) {
          const rec = await this.dataService.getByUUID('records', p.recordUuid);
          newPayments.push({ ...p, recordId: rec ? rec.id : null });
        } else {
          newPayments.push(p);
        }
      }
      return { ...data, payments: newPayments };
    } catch (_) {
      return data;
    }
  }

  /**
   * 將遠端 record 的 ledgerUuid 解析為本地 ledgerId。
   * @param {object} data
   * @returns {object} 已修正 ledgerId 的 data
   */
  async _resolveLedgerId(data) {
    if (!data.ledgerUuid) return data;
    try {
      const ledgers = await this.dataService.getLedgers();
      const matched = ledgers.find(l => l.uuid === data.ledgerUuid);
      console.log(`[SyncService] _resolveLedgerId: uuid=${data.ledgerUuid}, matched=${matched?.id} (${matched?.name}), activeLedgerId=${this.dataService.activeLedgerId}`);
      return { ...data, ledgerId: matched ? matched.id : this.dataService.activeLedgerId };
    } catch (_) {
      return data;
    }
  }

  /**
   * 將遠端 record 的 accountUuid 解析為本地 accountId。
   * @param {object} data
   * @returns {object} 已修正 accountId 的 data
   */
  async _resolveRecordAccountId(data) {
    if (!data.accountUuid) return data;
    try {
      const accounts = await this.dataService.getAccounts({ allLedgers: true });
      const matched = accounts.find(a => a.uuid === data.accountUuid);
      return { ...data, accountId: matched ? matched.id : null };
    } catch (_) {
      return data;
    }
  }

  /**
   * 將遠端 record 的 debtUuid 解析為本地 debtId。
   * @param {object} data
   * @returns {object} 已修正 debtId 的 data
   */
  async _resolveRecordDebtId(data) {
    if (!data.debtUuid) return data;
    try {
      const debt = await this.dataService.getByUUID('debts', data.debtUuid);
      return { ...data, debtId: debt ? debt.id : null };
    } catch (_) {
      return data;
    }
  }

  /**
   * 將遠端 recurring_transaction 的 accountUuid 解析為本地 accountId。
   * @param {object} data
   * @returns {object} 已修正 accountId 的 data
   */
  async _resolveRecurringAccountId(data) {
    if (!data.accountUuid) {
      return { ...data, accountId: null };
    }
    try {
      const accounts = await this.dataService.getAccounts({ allLedgers: true });
      const matched = accounts.find(a => a.uuid === data.accountUuid);
      return { ...data, accountId: matched ? matched.id : null };
    } catch (_) {
      return { ...data, accountId: null };
    }
  }

  async _resolveAllForeignKeys(storeName, data) {
      if (!data) return data;
      let resolved = await this._resolveLedgerId(data);
      if (storeName === 'records' || storeName === 'debts') {
          resolved = await this._resolveRecordAccountId(resolved);
          resolved = await this._resolveRecordDebtId(resolved);
      }
      if (storeName === 'recurring_transactions') {
          resolved = await this._resolveRecurringAccountId(resolved);
      }
      return resolved;
  }

  /**
   * @param {string} storeName
   * @param {object} data
   */
  async _applyAdd(storeName, data) {
    if (storeName === 'custom_categories') {
        if (window.app && window.app.categoryManager) {
            window.app.categoryManager.customCategories = data;
            window.app.categoryManager.saveCustomCategories(true);
        } else {
            localStorage.setItem('customCategories', JSON.stringify(data));
        }
        return;
    }

    if (storeName === 'category_order') {
        if (window.app && window.app.categoryManager) {
            window.app.categoryManager.categoryOrder = data;
            await window.app.categoryManager.saveCategorySettings(true);
        } else {
            localStorage.setItem('category_order', JSON.stringify(data));
        }
        return;
    }

    if (storeName === 'hidden_categories') {
        if (window.app && window.app.categoryManager) {
            window.app.categoryManager.hiddenCategories = data;
            await window.app.categoryManager.saveCategorySettings(true);
        } else {
            localStorage.setItem('hidden_categories', JSON.stringify(data));
        }
        return;
    }

    if (storeName === 'budget_settings') {
        if (window.app && window.app.budgetManager) {
            window.app.budgetManager.currentBudget = data.monthlyBudget || 0;
            window.app.budgetManager.categoryBudgets = data.categoryBudgets || {};
            await window.app.budgetManager.saveBudget(window.app.budgetManager.currentBudget, window.app.budgetManager.categoryBudgets, true);
            if (window.app && window.app.router && window.app.router.routes['home'] && typeof window.app.router.routes['home'].loadBudgetWidget === 'function') {
                window.app.router.routes['home'].loadBudgetWidget(); // Auto refresh if available
            }
        } else {
            localStorage.setItem('monthlyBudget', data.monthlyBudget || 0);
            localStorage.setItem('categoryBudgets', JSON.stringify(data.categoryBudgets || {}));
        }
        return;
    }

    // 如果 UUID 已存在則當新增處理，避免重複
    if (data.uuid) {
        const existing = await this.dataService.getByUUID(storeName, data.uuid);
        if (existing) {
            await this._applyUpdateWithId(storeName, existing.id, data);
            return;
        }
    }

    switch (storeName) {
      case 'ledgers': {
        await this.dataService.addLedger(data, true);
        break;
      }
      case 'records': {
        // 同步時解析全部外鍵 UUID
        let resolved = await this._resolveLedgerId(data);
        resolved = await this._resolveRecordAccountId(resolved);
        resolved = await this._resolveRecordDebtId(resolved);
        await this.dataService.addRecord(resolved, true);
        break;
      }
      case 'accounts': {
        let resolved = await this._resolveLedgerId(data);
        await this.dataService.addAccount(resolved, true);
        break;
      }
      case 'contacts': {
        let resolved = await this._resolveLedgerId(data);
        await this.dataService.addContact(resolved, true);
        break;
      }
      case 'debts': {
        // 同步時解析 contactUuid → contactId， recordUuid → recordId
        let resolved = await this._resolveLedgerId(data);
        resolved = await this._resolveDebtContactId(resolved);
        resolved = await this._resolveDebtRecordId(resolved);
        resolved = await this._resolveDebtPayments(resolved);
        const debtId = await this.dataService.addDebt(resolved, true);

        // 如果該欠款關聯了一個紀錄 (包含初次建立紀錄與還款紀錄)，且該紀錄在本地已存在
        // 則反向更新該紀錄的 debtId，解決 topoOrder 造成的單向綁定問題
        if (resolved.recordId && debtId) {
            await this.dataService.updateRecord(resolved.recordId, { debtId: debtId }, true);
        }
        if (resolved.payments && Array.isArray(resolved.payments) && debtId) {
          for (const p of resolved.payments) {
            if (p.recordId) {
              await this.dataService.updateRecord(p.recordId, { debtId: debtId }, true);
            }
          }
        }
        break;
      }
      case 'recurring_transactions': {
        let resolved = await this._resolveLedgerId(data);
        resolved = await this._resolveRecurringAccountId(resolved);
        await this.dataService.addRecurringTransaction(resolved);
        break;
      }
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
    if (storeName === 'custom_categories') {
        if (window.app && window.app.categoryManager) {
            window.app.categoryManager.customCategories = data;
            window.app.categoryManager.saveCustomCategories(true);
        } else {
            localStorage.setItem('customCategories', JSON.stringify(data));
        }
        return;
    }

    if (storeName === 'category_order') {
        if (window.app && window.app.categoryManager) {
            window.app.categoryManager.categoryOrder = data;
            await window.app.categoryManager.saveCategorySettings(true);
        } else {
            localStorage.setItem('category_order', JSON.stringify(data));
        }
        return;
    }

    if (storeName === 'hidden_categories') {
        if (window.app && window.app.categoryManager) {
            window.app.categoryManager.hiddenCategories = data;
            await window.app.categoryManager.saveCategorySettings(true);
        } else {
            localStorage.setItem('hidden_categories', JSON.stringify(data));
        }
        return;
    }

    if (storeName === 'budget_settings') {
        if (window.app && window.app.budgetManager) {
            window.app.budgetManager.currentBudget = data.monthlyBudget || 0;
            window.app.budgetManager.categoryBudgets = data.categoryBudgets || {};
            await window.app.budgetManager.saveBudget(window.app.budgetManager.currentBudget, window.app.budgetManager.categoryBudgets, true);
            if (window.app && window.app.router && window.app.router.routes['home'] && typeof window.app.router.routes['home'].loadBudgetWidget === 'function') {
                window.app.router.routes['home'].loadBudgetWidget(); // Auto refresh if available
            }
        } else {
            localStorage.setItem('monthlyBudget', data.monthlyBudget || 0);
            localStorage.setItem('categoryBudgets', JSON.stringify(data.categoryBudgets || {}));
        }
        return;
    }

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
        case 'ledgers': {
          // 保護本地的共用元資料，防止被遠端的舊資料（無此欄位）覆蓋
          // 只有當 remote data 沒有指定這些欄位時，才用 local 的值填補
          const localLedger = await this.dataService.getLedger(id);
          const protectedData = { ...data };
          if (localLedger) {
            if (protectedData.isShared === undefined) protectedData.isShared = localLedger.isShared;
            if (protectedData.sharedFileId === undefined) protectedData.sharedFileId = localLedger.sharedFileId;
            if (protectedData.type === undefined) protectedData.type = localLedger.type;
          }
          await this.dataService.updateLedger(id, protectedData, true);
          break;
        }
        case 'records': {
          // 同步時解析全部外鍵 UUID
          let resolved = await this._resolveLedgerId(data);
          resolved = await this._resolveRecordAccountId(resolved);
          resolved = await this._resolveRecordDebtId(resolved);
          await this.dataService.updateRecord(id, resolved, true);
          break;
        }
        case 'accounts': {
          let resolved = await this._resolveLedgerId(data);
          await this.dataService.updateAccount(id, resolved, true);
          break;
        }
        case 'contacts': {
          let resolved = await this._resolveLedgerId(data);
          await this.dataService.updateContact(id, resolved, true);
          break;
        }
        case 'debts': {
          // 同步時解析 contactUuid → contactId， recordUuid → recordId
          let resolved = await this._resolveLedgerId(data);
          resolved = await this._resolveDebtContactId(resolved);
          resolved = await this._resolveDebtRecordId(resolved);
          resolved = await this._resolveDebtPayments(resolved);
          await this.dataService.updateDebt(id, resolved, true);

          // 同步更新關聯紀錄 (包含初次建立紀錄與還款紀錄)
          if (resolved.recordId) {
              await this.dataService.updateRecord(resolved.recordId, { debtId: id }, true);
          }
          if (resolved.payments && Array.isArray(resolved.payments)) {
            for (const p of resolved.payments) {
              if (p.recordId) {
                await this.dataService.updateRecord(p.recordId, { debtId: id }, true);
              }
            }
          }
          break;
        }
        case 'recurring_transactions': {
          let resolved = await this._resolveLedgerId(data);
          resolved = await this._resolveRecurringAccountId(resolved);
          await this.dataService.updateRecurringTransaction(id, resolved, true);
          break;
        }
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
        case 'ledgers':
          await this.dataService.deleteLedger(id, true);
          break;
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
        case 'recurring_transactions':
          await this.dataService.deleteRecurringTransaction(id, true);
          break;
        default:
          console.warn('[SyncService] Unknown store for delete:', storeName);
      }
  }

  // ──────────────────────────────────────────────
  // Google Picker API
  // ──────────────────────────────────────────────

  /**
   * 打開 Google Picker 選擇共用帳本檔案
   * 透過這個方式選取的/授權的檔案，會被 Google 自動賦予 drive.file 權限
   * @param {string|string[]} [fileIds=null] - 若已知 File ID，可傳入加速授權流程
   * @returns {Promise<string>} 回傳選擇的檔案 ID
   */
  async openSharedLedgerPicker(fileIds = null) {
    if (typeof gapi === 'undefined') {
      throw new Error('Google API 未載入');
    }

    return new Promise((resolve, reject) => {
      gapi.load('picker', {
        callback: () => {
          const view = new google.picker.DocsView(google.picker.ViewId.DOCS)
            .setMimeTypes('application/json');

          const builder = new google.picker.PickerBuilder()
            .addView(view)
            .setTitle(fileIds ? '請同意授權存取此共用帳本' : '在「與我共用」尋找共用帳本 (EasyAccounting_Shared 開頭)')
            .setOAuthToken(this.accessToken)
            .setCallback((data) => {
              if (data.action === google.picker.Action.PICKED) {
                const file = data.docs[0];
                resolve(file.id);
              } else if (data.action === google.picker.Action.CANCEL) {
                reject(new Error('使用者取消選擇'));
              }
            });

          // 如果有 API Key 則設定，沒有也能跑（僅在公開連結或特殊情況下可能會有影響）
          if (GOOGLE_API_KEY) {
            builder.setDeveloperKey(GOOGLE_API_KEY);
          }

          // 解析 App ID
          if (GOOGLE_CLIENT_ID) {
            const appId = GOOGLE_CLIENT_ID.split('-')[0];
            if (appId) {
                builder.setAppId(appId);
            }
          }

          // 新版 API 支援傳入已知 File ID（例如從輸入框貼上的代碼）進行無縫授權
          if (fileIds) {
            const idsString = Array.isArray(fileIds) ? fileIds.join(',') : fileIds;
            if (typeof view.setFileIds === 'function') {
                view.setFileIds(idsString);
            } else {
                // 退回最傳統的搜尋方式
                view.setQuery(idsString); 
            }
          } else {
            // 沒有提供 File ID 時，傳統的瀏覽模式
            view.setMode(google.picker.DocsViewMode.LIST);
          }
            
          const picker = builder.build();
          picker.setVisible(true);
        }
      });
    });
  }
}

export default SyncService;
