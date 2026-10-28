import { retryAppModules } from './app-module-retry'

export const APP_BOOTSTRAP_READY_EVENT = 'welding-journal:bootstrap-ready'

// Runs before the entry module, so recovery does not depend on React loading.
// No automatic reload: persistent network failures must not create a loop.
export const APP_BOOTSTRAP_RECOVERY_SCRIPT = `(()=>{
  const retryModules=${retryAppModules.toString()};
  const failed=(event)=>{
    const script=event.target;
    let ownModule=script instanceof HTMLScriptElement&&script.type==='module'&&script.src&&new URL(script.src).origin===location.origin;
    if(!ownModule&&event instanceof ErrorEvent&&event.filename){
      try{const file=new URL(event.filename,location.href);ownModule=file.origin===location.origin&&file.pathname.startsWith('/assets/');}catch{}
    }
    if(!ownModule)return;
    const panel=document.getElementById('app-bootstrap-recovery');
    const retry=document.getElementById('app-bootstrap-retry');
    if(panel&&retry){panel.hidden=false;retry.onclick=()=>{retry.disabled=true;void retryModules([script?.src||event.filename||'']);};}
  };
  const ready=()=>{
    window.removeEventListener('error',failed,true);
    const panel=document.getElementById('app-bootstrap-recovery');
    const retry=document.getElementById('app-bootstrap-retry');
    if(panel)panel.hidden=true;
    if(retry)retry.onclick=null;
  };
  window.addEventListener('error',failed,true);
  window.addEventListener('${APP_BOOTSTRAP_READY_EVENT}',ready,{once:true});
})();`
