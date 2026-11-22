import {ensureIdentitySchema} from '../server/identity-schema.mjs';
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
  const handle=makeHandler({sql,bank,handleAuth:createAuthRoutes({sendCode:async(email,code)=>{
    if (email==='unavailable@example.org') throw new Error('Mail provider unavailable');
    mail.set(email,code);
  }})});
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
    const failed=await one('register',{name:'Mail check',institution:'Test College',email:'unavailable@example.org',password});
    assert.equal(failed.status,503);
    assert.match(failed.error,/verification email/);
    assert.equal((await sql`SELECT email FROM registrations WHERE email='unavailable@example.org'`).length,0);
    for(const [i,request] of [one,two].entries()){
      const email='tester'+i+'@example.org',institution='College '+i;
      const signup=await request('register',{name:'Test Student',institution,email,password});
      assert(signup.status<300,JSON.stringify(signup));
      assert.equal((await request('me')).user,null);
      const verified=await request('verify',{email,otp:mail.get(email)});
      assert(verified.status<300,JSON.stringify(verified));
      assert.equal((await request('me')).user.institution,institution);
      mail.clear();
      const duplicate=await request('register',{name:'Test Student',institution,email,password});
      assert.equal(duplicate.status,409);
      assert.equal(mail.size,0);
      assert.equal((await request('register',{name:'Test Student',institution:' ',email:'extra'+email,password})).status,400);
      assert.equal(mail.size,0);
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
    // Recreate the previous identity columns while both students still have live sessions.
    await db.exec(`ALTER TABLE users DROP COLUMN institution;
      ALTER TABLE registrations DROP COLUMN institution;
      ALTER TABLE users ADD COLUMN cms text UNIQUE;
      UPDATE users SET cms=upper(id::text);
      ALTER TABLE users ALTER COLUMN cms SET NOT NULL;
      ALTER TABLE registrations ADD COLUMN cms text NOT NULL;`);
    await ensureIdentitySchema(sql);
    assert.equal((await one('me')).user.institution,'Riphah International University, Sahiwal — Sahiwal');
    await sql`UPDATE users SET institution='Riphah Sahiwal' WHERE id=${owner.id}`;
    await sql`UPDATE users SET institution='Another College' WHERE id=${me.id}`;
    await ensureIdentitySchema(sql);
    const institutions=(await two('admin')).students;
    assert.equal(institutions.find(s=>s.id===me.id).institution,'Another College');
    assert.equal(institutions.find(s=>s.id===owner.id).institution,'Riphah International University, Sahiwal — Sahiwal');
    assert.equal((await one('me')).user.id,owner.id);
    assert.equal((await two('admin')).totalAttempts,1);
    const newcomer=client();
    const email='after-upgrade@example.org';
    assert.equal((await newcomer('register',{name:'New Student',institution:'City College',shareInstitution:'yes',email,password})).status,200);
    assert.deepEqual((await client()('institutions')).names,[]);
    assert.equal((await newcomer('verify',{email,otp:mail.get(email)})).user.institution,'City College');
    assert.deepEqual((await client()('institutions')).names,['City College']);
    assert.equal((await one('logout')).status,200);
    assert.equal((await one('get',{id})).status,401);
    const back=await one('login',{email:'TESTER0@example.org',password});
    assert(back.status<300,JSON.stringify(back));
    assert.equal((await one('get',{id})).attempt.score,final.score);
    const recovery=client(), newPassword=password+'A', finalPassword=password+'B';
    assert.equal((await recovery('saveProfile',{name:'Unauthorized'})).status,401);
    assert.equal((await one('saveProfile',{name:'Updated Student'})).status,200);
    assert.equal((await one('me')).user.name,'Updated Student');
    const change={oldPassword:password,newPassword,confirmPassword:newPassword};
    assert.equal((await one('changePassword',{...change,oldPassword:'Incorrect password'})).status,400);
    assert.equal((await one('changePassword',{...change,confirmPassword:'different'})).status,400);
    assert.equal((await one('changePassword',change)).status,200);
    assert.equal((await one('me')).user.id,owner.id);
    assert.equal((await recovery('login',{email:owner.email,password})).status,401);
    const reset={newPassword:finalPassword,confirmPassword:finalPassword};
    assert.equal((await recovery('resetPassword',reset)).status,410);
    mail.clear();
    assert.equal((await recovery('forgotPassword',{email:'unknown@example.org'})).status,200);
    assert.equal(mail.size,0);
    assert.equal((await recovery('forgotPassword',{email:owner.email})).status,200);
    const otp=mail.get(owner.email);
    assert.match(otp,/^\d{6}$/);
    assert.equal((await recovery('verifyReset',{otp:otp==='000000'?'000001':'000000'})).status,400);
    assert.equal((await recovery('verifyReset',{otp})).status,200);
    assert.equal((await recovery('resetPassword',{...reset,confirmPassword:'mismatch'})).status,400);
    assert.equal((await recovery('resetPassword',reset)).status,200);
    assert.equal((await recovery('resetPassword',reset)).status,410);
    assert.equal((await one('me')).user,null);
    assert.equal((await recovery('login',{email:owner.email,password:newPassword})).status,401);
    assert.equal((await recovery('login',{email:owner.email,password:finalPassword})).status,200);
  } finally {await db.close();}
});
