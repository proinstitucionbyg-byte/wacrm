import {expect,it} from 'vitest';
import {encodeGroupListCache,readGroupListCache} from './group-list-cache';
const scope={worker_id:'worker-one',line_key:'WA-one',linked_phone:'51987020644'};
const list={kind:'list' as const,offset:0,total:92,groups:Array.from({length:92},(_,i)=>({id:`${100000000+i}@g.us`,name:'Grupo '+i,participantsLoaded:5}))};
it('restores all pages while keeping their original timestamp',()=>{const text=encodeGroupListCache(scope,list,1000);expect(readGroupListCache(text,scope,2000)).toEqual(list);expect(readGroupListCache(text,scope,61001)).toBeNull();});
it('cannot reuse group names for a different line, phone or worker',()=>{const text=encodeGroupListCache(scope,list,1000);for(const patch of [{line_key:'WA-two'},{linked_phone:'51900000001'},{worker_id:'worker-two'}])expect(readGroupListCache(text,{...scope,...patch},2000)).toBeNull();});
it('rejects invalid, duplicated and unbounded snapshots',()=>{expect(readGroupListCache('broken',scope,2000)).toBeNull();expect(readGroupListCache(encodeGroupListCache(scope,{...list,groups:[list.groups[0],list.groups[0]]},1000),scope,2000)).toBeNull();expect(readGroupListCache(encodeGroupListCache(scope,{...list,groups:[{...list.groups[0],id:'not-a-group'}]},1000),scope,2000)).toBeNull();expect(readGroupListCache(encodeGroupListCache(scope,list,3000),scope,2000)).toBeNull();});
