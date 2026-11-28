export async function downloadFile(url:string){
 const response=await fetch(url,{signal:AbortSignal.timeout(60000)});
 if(!response.ok)throw Error('No se pudo descargar el archivo.');
 const blob=await response.blob();
 let name='imagen';try{name=decodeURIComponent(new URL(url,window.location.href).pathname.split('/').pop()||'imagen').replace(/[\\/\u0000-\u001f]/g,'_');}catch{/* Use a safe default name. */}
 if(!/\.[a-z0-9]{2,8}$/i.test(name)){const extension=({'image/jpeg':'jpg','image/png':'png','image/webp':'webp','image/gif':'gif'} as Record<string,string>)[blob.type];if(extension)name+='.'+extension;}
 const objectUrl=URL.createObjectURL(blob),link=document.createElement('a');
 link.href=objectUrl;link.download=name;link.style.display='none';document.body.appendChild(link);
 try{link.click();}finally{link.remove();setTimeout(()=>URL.revokeObjectURL(objectUrl),30000);}
}
