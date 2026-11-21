import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {openLocal} from '../scripts/local-db.mjs';
import {makeHandler} from '../server/api.mjs';
import {createAuthRoutes} from '../server/auth.mjs';
import bank from '../data/bank.json' with {type:'json'};

test('verified accounts, enforced ownership, persistence, admin controls and logout',async()=>{
  process.env.AUTH_SECRET=randomBytes(48).toString('base64');
  const {db,sql}=await openLocal();
  const mail=new Map();
  const handle=makeHandler({sql,bank,handleAuth:createAuthRoutes({sendCode:async(email,code)=>mail.set(email,code)})});
  function client(){
    const cookies=new Map();
    return async(action,body={})=>{
      const response=await handle(new Request('https://portal.test/api/'+action,{method:'POST',headers:{
        'content-type':'application/json',origin:'https://portal.test',cookie:[...cookies].map(([k,v])=>k+'='+v).join('; ')
      },body:JSON.stringify(body)}),{ip:'127.0.0.1'});
      for(const line of response.headers.getSetCookie()){
        const [key,value]=line.split(';')[0].split('=');cookies.set(key,value);
      }
      return {status:response.status,...await response.json()};
    };
  }
  const one=client(),two=client();
  const password=randomBytes(24).toString('hex');
  try{
    assert.equal((await one('list')).status,401);
    for(const [i,request] of [one,two].entries()){
      const email='tester'+i+'@example.org',cms='CMS-'+i;
      const signup=await request('register',{name:'Test Student',cms,email,password});
      assert(signup.status<300,JSON.stringify(signup));
      assert.equal((await request('me')).user,null);
      const verified=await request('verify',{email,otp:mail.get(email)});
      assert(verified.status<300,JSON.stringify(verified));
      assert.equal((await request('me')).user.cms.toUpperCase(),cms);
    }
    assert.equal((await one('admin')).status,403);
    assert.equal((await two('toggle',{id:bank[0].id,disabled:true})).status,403);
    const {attempt}=await one('start',{subjects:['db','dsa','ai'],size:20,mode:'exam'});
    const id=attempt.id;
    assert.equal(attempt.questions.length,20);
    for(const action of ['get','answer','finish']) assert.equal((await two(action,{id,index:0,choice:0})).status,404);
    assert.equal((await two('list')).attempts.length,0);
    assert.equal((await one('finish',{id})).status,409);
    for(let index=0;index<20;index++) assert.equal((await one('answer',{id,index,choice:index%4})).status,200);
    assert(!(Object.hasOwn((await one('get',{id})).attempt.questions[0],'correct')));
    const final=(await one('finish',{id})).attempt;
    assert.equal(final.score,final.questions.filter(q=>q.correct===q.choice).length);
    assert.equal((await one('list')).attempts[0].score,final.score);
    const me=(await two('me')).user;
    await sql`UPDATE users SET admin=true WHERE id=${me.id}`;
    assert.equal((await two('admin')).totalAttempts,1);
    const owner=(await one('me')).user;
    assert.equal((await one('adminStudent',{id:me.id})).status,403);
    assert.equal((await one('adminAttempt',{id})).status,403);
    const profile=await two('adminStudent',{id:owner.id});
    assert.equal(profile.attempts[0].score,final.score);
    assert(profile.attempts[0].completedAt);
    const reviewed=(await two('adminAttempt',{id})).attempt;
    assert.equal(reviewed.studentId,owner.id);
    assert.equal(reviewed.questions[0].choice,final.questions[0].choice);
    assert.equal((await two('toggle',{id:bank[0].id,disabled:true})).status,200);
    assert((await two('admin')).questions.find(q=>q.id===bank[0].id).disabled);
    assert.equal((await one('logout')).status,200);
    assert.equal((await one('get',{id})).status,401);
    const back=await one('login',{cms:'CMS-0',password});
    assert(back.status<300,JSON.stringify(back));
    assert.equal((await one('get',{id})).attempt.score,final.score);
  } finally {await db.close();}
});
