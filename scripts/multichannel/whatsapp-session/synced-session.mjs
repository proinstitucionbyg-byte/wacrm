// The vendor listens only for change:hasSynced. An already restored session
// can finish syncing before that listener is installed. Resume its own callback
// only with the real connected socket, paired phone and completed sync.
export async function resumeAlreadySyncedSession(){
 const socket=window.require('WAWebSocketModel').Socket;
 const own=window.require('WAWebUserPrefsMeUser').getMaybeMePnUser();
 if(socket.state!=='CONNECTED'||socket.hasSynced!==true||own?.server!=='c.us'||!/^\d{7,15}$/.test(own.user??'')
   ||typeof window.WWebJS!=='undefined'||typeof window.onAppStateHasSyncedEvent!=='function')return false;
 if(!window.__wacrmSyncResume){
  window.__wacrmSyncResume=Promise.resolve().then(()=>window.onAppStateHasSyncedEvent());
 }
 try{await window.__wacrmSyncResume;return typeof window.WWebJS?.getMessageModel==='function';}
 finally{delete window.__wacrmSyncResume;}
}
