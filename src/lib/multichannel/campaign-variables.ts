export function campaignVariableKey(value:string){return value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toLowerCase().replace(/\s+/g,'_');}
export function renderCampaignText(template:string,variables:Record<string,string>){
 const result=template.replace(/\{\{\s*([^{}]+?)\s*\}\}|\[([^\[\]\r\n]+)\]/g,(_token,a:string|undefined,b:string|undefined)=>{
  const key=campaignVariableKey(a??b??'');
  if(!Object.hasOwn(variables,key)||!variables[key].trim())throw Error('Falta el valor de ['+key+'].');
  return variables[key];
 });
 if(/\{\{|\}\}/.test(result))throw Error('Hay una variable sin cerrar.');
 if(!result.trim()||result.length>4000)throw Error('El mensaje personalizado está vacío o supera 4000 caracteres.');
 return result;
}
