import {parsePhoneNumberFromString} from 'libphonenumber-js/max';

export function campaignPhone(value:string){
 if(typeof value!=='string'||value.length>40||!/^[+\d\s().-]+$/.test(value))return null;
 let digits=value.replace(/[\s().-]/g,'');
 if(digits.startsWith('00'))digits='+'+digits.slice(2);
 if(/^9\d{8}$/.test(digits))digits='+51'+digits;
 else if(/^\d{10,15}$/.test(digits))digits='+'+digits;
 if(!/^\+[1-9]\d{7,14}$/.test(digits))return null;
 const phone=parsePhoneNumberFromString(digits,{extract:false});
 if(!phone?.isValid()||phone.ext)return null;
 return {phone:String(phone.number),country:phone.country??null,callingCode:phone.countryCallingCode};
}
