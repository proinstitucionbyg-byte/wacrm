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
    async inject() {
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          await this.pupPage.waitForFunction('window.Debug?.VERSION !== undefined', {
            timeout: this.options.authTimeoutMs || 30_000,
          });
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
