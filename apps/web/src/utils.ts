export function compactCount(count:number):string{
  if(!Number.isFinite(count)||count<0)return "0";
  if(count<1000)return String(Math.floor(count));
  return new Intl.NumberFormat("cs-CZ",{notation:"compact",maximumFractionDigits:1}).format(count);
}
export function formatShortDate(value:string):string{
  const d=new Date(value);
  if(Number.isNaN(d.getTime()))return "Bez data";
  return new Intl.DateTimeFormat("cs-CZ",{dateStyle:"medium"}).format(d);
}
