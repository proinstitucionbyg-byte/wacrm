import{describe,it,expect}from'vitest';
import{renderCampaignText}from'./campaign-variables';
import{parseRecipientPaste}from'./recipient-import';
describe('ordered campaign personalization',()=>{
 it('keeps phone, name and date from the same CSV row in original order',()=>{
  const r=parseRecipientPaste('Telefono,Nombre,Fecha1\n940966875,Luis,28/11/2026\n937467119,Rosa,29/11/2026');
  expect(r.errors).toEqual([]);
  expect(r.recipients.map(row=>renderCampaignText('Hola [nombre], vence [fecha1]. {{telefono}}',{...row.variables,nombre:row.name,telefono:row.phone}))).toEqual(['Hola Luis, vence 28/11/2026. +51940966875','Hola Rosa, vence 29/11/2026. +51937467119']);
 });
 it('blocks duplicate phones with conflicting identity instead of shifting names',()=>{
  const r=parseRecipientPaste('Telefono,Nombre\n940966875,Luis\n940966875,Rosa\n937467119,Pedro');
  expect(r.errors[0]).toContain('diferentes');expect(r.recipients.map(r=>r.name)).toEqual(['Luis','Pedro']);
 });
 it('leaves ordinary campaigns unchanged and refuses missing values used by a template',()=>{
  expect(renderCampaignText('Información general',{})).toBe('Información general');
  expect(()=>renderCampaignText('Hola [nombre]',{})).toThrow('nombre');
  expect(()=>renderCampaignText('Hola {{nombre}',{nombre:'Ana'})).toThrow('cerrar');
  expect(()=>renderCampaignText('[nombre]',{nombre:'x'.repeat(4001)})).toThrow('4000');
 });
 it('does not expand placeholder text supplied inside a variable value',()=>{
  expect(renderCampaignText('[a] y [b]',{a:'[b]',b:'Rosa'})).toBe('[b] y Rosa');
  expect(()=>renderCampaignText('[toString]',{})).toThrow('tostring');
 });
});
