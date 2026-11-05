import {installMessageModelCompatibility} from './message-model-compat.mjs';
import {observeNativeQr} from './native-qr.mjs';
import {installMediaModelCompatibility} from './media-model-compat.mjs';
import {randomUUID} from 'node:crypto';
import {snapshotMediaReceipts,takePreparedMediaReceipt} from './media-receipt.mjs';
import {resumeAlreadySyncedSession} from './synced-session.mjs';
// whatsapp-web.js 1.34.7 polls with evaluate() before the page has stabilized.
// waitForFunction survives a page navigation; keep vendor source unmodified.
export function navigationSafeClient(BaseClient) {
  return class NavigationSafeClient extends BaseClient {
    constructor(...args) {
      super(...args);
      this.initialNavigationRecoveries = 0;
      this.sessionBecameReady = false;
      this.initializationFinished = false;
      this.authenticationSeen = false;
      this.once('authenticated',()=>{this.authenticationSeen=true;});
      this.once('ready', () => { this.sessionBecameReady = true; });
    }
    async initialize() {
      try { return await super.initialize(); }
      finally { this.initializationFinished = true; }
    }
    async getState() {
      const state=await super.getState();
      // The vendor can initially expose the own LID as info.wid. Its digits
      // are not a telephone number; replace it only with WhatsApp's own PN.
      if(state==='CONNECTED'&&this.info?.wid?.server==='lid'){
        const own=await this.pupPage.evaluate(()=>{
          try{const pn=window.require('WAWebUserPrefsMeUser').getMaybeMePnUser();return pn?.server==='c.us'&&/^\d{7,15}$/.test(pn.user??'')?{user:pn.user,server:'c.us',_serialized:pn.user+'@c.us'}:null;}catch{return null;}
        });
        if(own)this.info.wid=own;
      }
      return state;
    }
    async sendMessage(...args) {
      await this.pupPage.evaluate(installMessageModelCompatibility);
      const media=args[1]?.mimetype?args[1]:args[2]?.media;
      if(!media)return super.sendMessage(...args);
      await this.pupPage.evaluate(installMediaModelCompatibility);
      const before=await this.pupPage.evaluate(snapshotMediaReceipts,{chatId:args[0]});
      const token=randomUUID();media.wacrmReceiptToken=token;
      let sent,failure;
      try{sent=await super.sendMessage(...args);}catch(error){failure=error;}finally{delete media.wacrmReceiptToken;}
      let proof;try{proof=await this.pupPage.evaluate(takePreparedMediaReceipt,token);}catch{/* A valid provider result is still authoritative. */}
      if(sent?.id?._serialized)return sent;
      if(!proof){if(failure)throw failure;return sent;}
      const after=await this.pupPage.evaluate(snapshotMediaReceipts,{chatId:args[0],filehash:proof.filehash});
      const created=after.chatId===before.chatId?after.ids.filter(id=>!before.ids.includes(id)):[];
      if(created.length===1)return this.getMessageById(created[0]);
      if(failure)throw failure;
      return sent; // An ambiguous outcome stays reserved; never send again here.
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
          const result=await super.inject();
          if(!this.authenticationSeen&&!this.sessionBecameReady&&typeof this.pupPage.evaluate==='function')await this.pupPage.evaluate(resumeAlreadySyncedSession);
          return result;
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
