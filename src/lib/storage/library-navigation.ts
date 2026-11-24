import type {MediaKind} from './media-library';
export type LibraryLocation={folder:string;mode:'folders'|'all'|'trash';kind?:MediaKind};
export function isLibrarySubtree(path:string,parent:string){return path===parent||path.startsWith(parent+'/');}
export function parentLibraryFolder(path:string){const index=path.lastIndexOf('/');return index>0?path.slice(0,index):'/';}
export function appendLibraryLocation(state:{items:LibraryLocation[];index:number},next:LibraryLocation){const current=state.items[state.index];if(current.folder===next.folder&&current.mode===next.mode&&current.kind===next.kind)return state;const items=[...state.items.slice(0,state.index+1),next];return {items,index:items.length-1};}
export function remapLibraryLocations(items:LibraryLocation[],oldPath:string,newPath:string){return items.map(item=>isLibrarySubtree(item.folder,oldPath)?{...item,folder:newPath+item.folder.slice(oldPath.length)}:item);}
