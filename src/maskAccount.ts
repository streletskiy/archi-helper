export function maskAccount(value:string):string {
  const characters=Array.from(value.trim());
  if(characters.length<=3)return '*'.repeat(characters.length||3);
  return characters.slice(0,2).join('')+'*'.repeat(characters.length-3)+characters.at(-1);
}
