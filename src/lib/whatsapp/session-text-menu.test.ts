import{describe,it,expect}from'vitest';
import{renderSessionTextMenu}from'./session-text-menu';
describe('WhatsApp Web text menus',()=>{
 it('renders existing button IDs as numbered options without changing the branch IDs',()=>{
  expect(renderSessionTextMenu({kind:'buttons',body:'¿Cómo te ayudamos?',buttons:[{id:'sales_farma',title:'Farmacia'},{id:'academic_support',title:'Soporte'}]})).toEqual({text:'¿Cómo te ayudamos?\n\n1. Farmacia\n2. Soporte\n\nResponde con el número de la opción.',options:[{id:'sales_farma',title:'Farmacia'},{id:'academic_support',title:'Soporte'}]});
 });
 it('keeps list ordering and refuses ambiguous IDs',()=>{
  expect(renderSessionTextMenu({kind:'list',body:'Opciones',button_label:'Ver',sections:[{title:'Uno',rows:[{id:'a',title:'Curso A'}]},{rows:[{id:'b',title:'Curso B'}]}]}).options.map(row=>row.id)).toEqual(['a','b']);
  expect(()=>renderSessionTextMenu({kind:'buttons',body:'Opciones',buttons:[{id:'same',title:'A'},{id:'same',title:'B'}]})).toThrow(/Duplicate|repetidos/);
 });
});
