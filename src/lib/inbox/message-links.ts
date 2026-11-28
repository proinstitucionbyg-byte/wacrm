import{campaignPhone}from'@/lib/multichannel/campaign-phone';
export type MessageLink={kind:'text'|'url'|'email'|'phone';text:string;href?:string;phone?:string};
export function messageLinks(text:string):MessageLink[]{
 const pattern=/(?:https?:\/\/|www\.|meet\.google\.com\/)[^\s<>]+|[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9.-]*[A-Z0-9])?\.[A-Z]{2,}|(?:[A-Z0-9-]+\.)+[A-Z]{2,}(?:\/[^\s<>]*)?|(?<![\w])\+?\d(?:[\d \t().-]*\d){7,14}(?![\w])/gi;
 const rows:MessageLink[]=[];let start=0;
 for(const match of text.matchAll(pattern)){
  const index=match.index!;if(index>start)rows.push({kind:'text',text:text.slice(start,index)});
  const raw=match[0],value=raw.replace(/[.,;!?)\]}]+$/,'');let item:MessageLink={kind:'text',text:value};
  if(value.includes('@'))item={kind:'email',text:value,href:'mailto:'+value};
  else if(/[a-z]/i.test(value)){try{const url=new URL(/^https?:\/\//i.test(value)?value:'https://'+value);if(['https:','http:'].includes(url.protocol)&&!url.username&&!url.password)item={kind:'url',text:value,href:url.href};}catch{/* Leave malformed links as text. */}}
  else{const phone=campaignPhone(value);if(phone)item={kind:'phone',text:value,phone:phone.phone,href:'https://wa.me/'+phone.phone.slice(1)};}
  rows.push(item);if(value.length<raw.length)rows.push({kind:'text',text:raw.slice(value.length)});start=index+raw.length;
 }
 if(start<text.length)rows.push({kind:'text',text:text.slice(start)});return rows;
}
