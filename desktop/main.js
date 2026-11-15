'use strict';
const {app,BrowserWindow,shell,dialog}=require('electron');
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),dns=require('node:dns').promises,net=require('node:net');
const root=path.resolve(__dirname,'public');let server;
const types={'.html':'text/html; charset=utf-8','.js':'application/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.xml':'application/xml; charset=utf-8','.webmanifest':'application/manifest+json','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp'};
const send=(res,code,body,type='text/plain; charset=utf-8')=>{res.writeHead(code,{'Content-Type':type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(body)};
async function remote(raw,depth=0){
 if(depth>3)throw Error('Too many redirects');
 const u=new URL(raw);
 if(!['https:','http:'].includes(u.protocol)||u.username||u.password)throw Error('Invalid feed address');
 const host=u.hostname.toLowerCase();
 if(host==='localhost'||host.endsWith('.local')||host.endsWith('.internal'))throw Error('Blocked host');
 const addresses=await dns.lookup(host,{all:true});
 for(const {address} of addresses){
  if(net.isIP(address)===6){if(address==='::1'||address==='::'||address.startsWith('fc')||address.startsWith('fd')||address.startsWith('fe80')||address.startsWith('::ffff:'))throw Error('Blocked IP');}
  else{const a=address.split('.').map(Number);if(a[0]===10||a[0]===127||a[0]===0||a[0]>=224||a[0]===169&&a[1]===254||a[0]===172&&a[1]>=16&&a[1]<=31||a[0]===192&&a[1]===168)throw Error('Blocked IP');}
 }
 const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),20000);
 try{
  const r=await fetch(u,{redirect:'manual',signal:controller.signal,headers:{'User-Agent':'KamdarReader/0.2','Accept':'application/rss+xml,application/atom+xml,application/xml,text/xml,*/*'}});
  if([301,302,303,307,308].includes(r.status)){const location=r.headers.get('location');if(!location)throw Error('Redirect missing location');return await remote(new URL(location,u).href,depth+1);}
  if(!r.ok)throw Error('HTTP '+r.status);
  const chunks=[];let size=0;
  for await(const chunk of r.body){size+=chunk.length;if(size>12*1024*1024)throw Error('Feed too large');chunks.push(chunk);}
  return Buffer.concat(chunks);
 }finally{clearTimeout(timer)}
}
function serve(req,res){
 try{
 const u=new URL(req.url,'http://localhost');
 if(u.pathname==='/__feed'||u.pathname==='/feed.xml'&&!fs.existsSync(path.join(root,'feed.xml'))){
  const target=u.pathname==='/feed.xml'?'https://kamdar-wolf.github.io/e621-rss-gallery/feed.xml':u.searchParams.get('url');
  if(!target)return send(res,400,'Missing feed URL');
  remote(target).then(data=>send(res,200,data,'application/xml; charset=utf-8')).catch(err=>send(res,502,'RSS: '+err.message));return;
 }
 let rel=u.pathname==='/'?'reader/index.html':decodeURIComponent(u.pathname).replace(/^\/+/, '');
 if(rel.endsWith('/'))rel+='index.html';
 const file=path.resolve(root,rel);
 if(!file.startsWith(root+path.sep))return send(res,403,'Forbidden');
 fs.stat(file,(err,stat)=>{
  if(err||!stat.isFile())return send(res,404,'Not found');
  const type=types[path.extname(file)]||'application/octet-stream';
  if(file.endsWith(path.join('reader','reader.js'))){
   let s=fs.readFileSync(file,'utf8');
   s=s.replace('new URL(source.url)',"new URL('/__feed?url='+encodeURIComponent(source.url),location.origin)");
   return send(res,200,s,type);
  }
  res.writeHead(200,{'Content-Type':type,'X-Content-Type-Options':'nosniff'});fs.createReadStream(file).pipe(res);
 });
 }catch(e){send(res,500,'Error: '+e.message)}
}
app.whenReady().then(async()=>{
 try{
 server=http.createServer(serve);
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve)});
 const port=server.address().port;
 const win=new BrowserWindow({width:1450,height:900,minWidth:840,minHeight:560,autoHideMenuBar:true,title:'Kamdar Reader',webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true}});
 win.webContents.setWindowOpenHandler(({url})=>{if(/^https?:\/\//.test(url))shell.openExternal(url);return {action:'deny'}});
 win.webContents.on('will-navigate',(e,url)=>{if(!url.startsWith('http://127.0.0.1:'+port+'/')){e.preventDefault();if(/^https?:\/\//.test(url))shell.openExternal(url)}});
 await win.loadURL('http://127.0.0.1:'+port+'/reader/');
 }catch(e){dialog.showErrorBox('Kamdar Reader',String(e));app.quit()}
});
app.on('window-all-closed',()=>app.quit());
app.on('before-quit',()=>{if(server)server.close()});
