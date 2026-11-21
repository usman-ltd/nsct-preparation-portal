import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import {extname,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {openLocal} from './local-db.mjs';
import {makeHandler} from '../server/api.mjs';
import {createAuthRoutes} from '../server/auth.mjs';
import bank from '../data/bank.json' with {type:'json'};

const base=fileURLToPath(new URL('../',import.meta.url));
const state=resolve(process.env.NSCT_LOCAL_STATE || resolve(base,'.local'));
const publicRoot=resolve(base,'public');
await mkdir(state,{recursive:true});
const privateKey=resolve(state,'auth-key');
try {await writeFile(privateKey,randomBytes(48).toString('base64'),{flag:'wx',mode:0o600});}
catch(e){if(e.code!=='EEXIST')throw e;}
process.env.AUTH_SECRET=await readFile(privateKey,'utf8');
const {db,sql}=await openLocal(resolve(state,'pg'));
const inbox=resolve(state,'latest-email.txt');
const handle=makeHandler({sql,bank,handleAuth:createAuthRoutes({sendCode:async(email,code)=>{
  await writeFile(inbox,[email,code].join('\n'),{mode:0o600});
}})});
const port=Number(process.env.PORT || 8743);
const origin='http://localhost:'+port;
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.png':'image/png','.jpg':'image/jpeg','.css':'text/css; charset=utf-8'};
const server=createServer(async(req,res)=>{
  try {
    const url=new URL(req.url,origin);
    if (url.pathname.startsWith('/api/')) {
      const chunks=[];
      let length=0;
      for await(const chunk of req) {
        length+=chunk.length;
        if(length>8192){res.writeHead(413).end();return;}
        chunks.push(chunk);
      }
      const request=new Request(url,{method:req.method,headers:req.headers,body:['GET','HEAD'].includes(req.method)?undefined:Buffer.concat(chunks)});
      const response=await handle(request,{ip:req.socket.remoteAddress});
      const headers=Object.fromEntries(response.headers);
      const cookies=response.headers.getSetCookie();
      if(cookies.length) headers['set-cookie']=cookies;
      res.writeHead(response.status,headers);
      res.end(await response.text());
      return;
    }
    const path=resolve(publicRoot,'.'+decodeURIComponent(url.pathname)+(url.pathname.endsWith('/')?'index.html':''));
    if (!path.startsWith(publicRoot+sep)) {res.writeHead(404).end();return;}
    const content=await readFile(path);
    res.writeHead(200,{'Content-Type':types[extname(path)]||'application/octet-stream','Cache-Control':'no-cache'});
    res.end(content);
  } catch {res.writeHead(404).end();}
});
server.listen(port,'127.0.0.1',()=>console.log('Local portal at '+origin+' — local verification emails are saved in .local/latest-email.txt'));
process.on('SIGINT',()=>server.close(async()=>{await db.close();process.exit();}));
