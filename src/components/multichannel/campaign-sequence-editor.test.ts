import{describe,it,expect,vi}from'vitest';
vi.mock('@/lib/storage/upload-media',()=>({uploadAccountMedia:vi.fn(),MEDIA_MAX_BYTES_BY_KIND:{image:5242880,audio:16777216,video:16777216,document:16777216}}));
import{campaignSequencePayload,type CampaignStepDraft}from'./campaign-sequence-editor';
describe('campaign sequence editor payload',()=>{
 it('preserves the chosen order and delay and attaches a caption only to caption-capable media',()=>{
  const steps:CampaignStepDraft[]=[{id:'text',kind:'text',body:'Hola',delay_seconds:15},{id:'audio',kind:'audio',body:'Presentación',url:'https://assets.example.test/audio.ogg',filename:'audio.ogg',delay_seconds:60},{id:'image',kind:'image',body:'Malla',url:'https://assets.example.test/image.png',filename:'image.png',delay_seconds:30}];
  expect(campaignSequencePayload(steps)).toEqual([{body:'Hola',delay_seconds:0},{body:'Presentación',delay_seconds:60,media:{kind:'audio',url:steps[1].url,filename:'audio.ogg'}},{body:'Malla',delay_seconds:30,media:{kind:'image',url:steps[2].url,filename:'image.png',caption:'Malla'}}]);
 });
 it('refuses a selected but not uploaded attachment instead of silently sending text',()=>{
  expect(()=>campaignSequencePayload([{id:'pending',kind:'video',body:'Video',delay_seconds:0}])).toThrow('Carga el archivo');
 });
 it('keeps a file-only step identifiable without creating an extra outgoing text',()=>{
  expect(campaignSequencePayload([{id:'video',kind:'video',body:'',url:'https://assets.example.test/video.mp4',filename:'clase.mp4',delay_seconds:0}])).toEqual([{body:'Video: clase.mp4',delay_seconds:0,media:{kind:'video',url:'https://assets.example.test/video.mp4',filename:'clase.mp4'}}]);
 });
});
