import {installMessageModelCompatibility} from './message-model-compat.mjs';
import {observeNativeQr} from './native-qr.mjs';
// whatsapp-web.js 1.34.7 polls with evaluate() before the page has stabilized.
// waitForFunction survives a page navigation; keep vendor source unmodified.
export function navigationSafeClient(BaseClient) {
  return class NavigationSafeClient extends BaseClient {
    constructor(...args) {
      super(...args);
      this.initialNavigationRecoveries = 0;
      this.sessionBecameReady = false;
      this.initializationFinished = false;
      this.once('ready', () => { this.sessionBecameReady = true; });
    }
    async initialize() {
      try { return await super.initialize(); }
      finally { this.initializationFinished = true; }
    }
    async sendMessage(...args) {
      await this.pupPage.evaluate(installMessageModelCompatibility);
      return super.sendMessage(...args);
    }
    async inject() {
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const nativeQr = typeof this.pupPage.exposeFunction === 'function';
          if (nativeQr) {
            if (!await this.pupPage.evaluate(() => typeof window.__wacrmReceiveNativeQr === 'function')) {
              await this.pupPage.exposeFunction('__wacrmReceiveNativeQr', png => this.emit('qr_image', png));
            }
            await this.pupPage.evaluate(observeNativeQr, '__wacrmReceiveNativeQr');
          }
          await this.pupPage.waitForFunction("(() => { try { return window.Debug?.VERSION !== undefined && !!window.require('WAWebSocketModel')?.Socket; } catch { return false; } })()", {
            timeout: nativeQr ? 0 : this.options.authTimeoutMs || 30_000,
          });
          if (nativeQr) await this.pupPage.evaluate(() => clearInterval(window.__wacrmNativeQrTimer));
          return await super.inject();
        } catch (error) {
          // A destroyed page has no surviving partial page listeners. Re-enter
          // initial injection only, bounded, before readiness; never retry sends.
          if (this.sessionBecameReady || attempt === 2 ||
              !/Execution context was destroyed|Cannot find context/i.test(error?.message ?? '')) {
            if (this.initializationFinished) {
              this.emit('session_error', 'navigation_failed');
              return; // An async frame listener must not crash the local panel.
            }
            throw error;
          }
          this.initialNavigationRecoveries++;
        }
      }
    }
  };
}
