export default {
 async fetch(request) {
  const cors={
   "Access-Control-Allow-Origin":"*",
   "Access-Control-Allow-Methods":"GET,OPTIONS",
   "Access-Control-Allow-Headers":"Content-Type,Accept"
  };
  if(request.method==="OPTIONS") return new Response(null,{headers:cors});
  const reqUrl=new URL(request.url);
  const target=reqUrl.searchParams.get("url");
  if(!target) return new Response(JSON.stringify({error:"url parametresi gerekli"}),{status:400,headers:{...cors,"Content-Type":"application/json"}});
  let parsed;
  try{parsed=new URL(target)}catch{return new Response(JSON.stringify({error:"gecersiz url"}),{status:400,headers:{...cors,"Content-Type":"application/json"}})}
  if(parsed.protocol!=="https:"||parsed.hostname!=="cbsapi.tkgm.gov.tr"||!parsed.pathname.startsWith("/megsiswebapi.v3/api/"))
   return new Response(JSON.stringify({error:"hedef izinli degil"}),{status:403,headers:{...cors,"Content-Type":"application/json"}});
  try{
   const upstream=await fetch(parsed.toString(),{headers:{"Accept":"application/json","User-Agent":"ParselSorgu/1.0"}});
   const body=await upstream.arrayBuffer();
   const h=new Headers(cors);
   h.set("Content-Type",upstream.headers.get("Content-Type")||"application/json; charset=utf-8");
   h.set("Cache-Control","public, max-age=300");
   return new Response(body,{status:upstream.status,headers:h});
  }catch(e){
   return new Response(JSON.stringify({error:"TKGM baglantisi basarisiz"}),{status:502,headers:{...cors,"Content-Type":"application/json"}});
  }
 }
};