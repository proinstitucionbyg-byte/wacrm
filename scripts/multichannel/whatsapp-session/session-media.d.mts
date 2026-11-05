export type SessionMedia={kind:'audio'|'image'|'video'|'document';url:string;caption?:string;filename?:string};
export function normalizeSessionMedia(value:unknown):SessionMedia;
export function sessionPayloadHash(body:string,media?:SessionMedia|null):string;
export function createSessionMediaLoader(options:{allowedOrigins:string[];makeMedia:(mime:string,data:string,filename?:string)=>unknown;fetchImpl?:typeof fetch;maxBytes?:number;timeoutMs?:number}):(value:SessionMedia)=>Promise<{content:unknown;options:Record<string,unknown>}>;
