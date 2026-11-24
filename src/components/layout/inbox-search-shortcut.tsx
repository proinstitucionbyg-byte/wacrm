'use client';
import {useCallback,useEffect} from 'react';
import {usePathname,useRouter} from 'next/navigation';
import {Search} from 'lucide-react';
import {useMemberPermissions} from '@/hooks/use-member-permissions';
export function InboxSearchShortcut(){
 const pathname=usePathname(),router=useRouter(),{can}=useMemberPermissions(),allowed=can('inbox','view');
 const open=useCallback(()=>{if(!allowed)return;if(pathname==='/inbox')window.dispatchEvent(new Event('wacrm:focus-inbox-search'));else router.push('/inbox?focusSearch=1');},[pathname,router,allowed]);
 useEffect(()=>{const shortcut=(event:KeyboardEvent)=>{if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='k'){event.preventDefault();open();}};document.addEventListener('keydown',shortcut);return()=>document.removeEventListener('keydown',shortcut);},[open]);
 if(!allowed)return null;
 return <button type="button" className="crm-quick-search" onClick={open} aria-label="Buscar conversaciones en Inbox"><Search aria-hidden="true"/><span>Buscar conversaciones en Inbox…</span><kbd>Ctrl + K</kbd></button>;
}
