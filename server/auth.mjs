import {createHash, createHmac, randomBytes, randomInt, scrypt, timingSafeEqual} from 'node:crypto';
import {promisify} from 'node:util';
import nodemailer from 'nodemailer';

const derive = promisify(scrypt);
const settings = {N:32768, r:8, p:3, maxmem:64*1024*1024};
const renewals = new WeakMap();
const sessionAge = 90*86400;
const salt = () => randomBytes(16).toString('hex');
const token = () => randomBytes(32).toString('hex');
const digest = value => createHash('sha256').update(value).digest('hex');
const emailValue = value => typeof value==='string' ? value.trim().toLowerCase() : '';
const cmsValue = value => typeof value==='string' ? value.trim().toUpperCase() : '';
const validEmail = value => value.length<=254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
const validCms = value => /^[A-Z0-9][A-Z0-9/_.-]{0,63}$/.test(value);
const validPassword = value => typeof value==='string' && value.length>=12 && value.length<=128;
const code = () => String(randomInt(1000000)).padStart(6,'0');
const reply = (body,status=200) => Response.json(body,{status,headers:{'cache-control':'private, no-store','x-content-type-options':'nosniff'}});
const failure = (error,status) => reply({error},status);

function keyed(value) {
  const secret=Buffer.from(process.env.AUTH_SECRET || '', 'base64');
  if (secret.length<32) throw new Error('Identity configuration unavailable');
  return createHmac('sha256',secret).update(value).digest('hex');
}

function cookieName(req,kind) {
  const url=new URL(req.url);
  const local=url.protocol==='http:' && ['localhost','127.0.0.1','[::1]'].includes(url.hostname);
  return (local?'':'__Host-')+'nsct_'+kind;
}

function setCookie(req,response,kind,value,age) {
  const name=cookieName(req,kind);
  response.headers.append('Set-Cookie',name+'='+value+'; Path=/; HttpOnly; SameSite=Lax; Max-Age='+age+(name.startsWith('__Host-')?'; Secure':''));
}

function readCookie(req,kind) {
  const prefix=cookieName(req,kind)+'=';
  const raw=(req.headers.get('cookie')||'').split(';').map(s=>s.trim()).find(s=>s.startsWith(prefix))?.slice(prefix.length);
  return typeof raw==='string' && /^[a-f0-9]{64}$/.test(raw) ? raw : null;
}

async function passwordHash(password,nonce=salt()) {
  const hash=await derive(password,Buffer.from(nonce,'hex'),32,settings);
  return ['scrypt',settings.N,settings.r,settings.p,nonce,hash.toString('hex')].join('$');
}

const dummySalt=salt();
async function matches(password,stored) {
  const parts=stored?.split('$');
  const nonce=parts?.[4] || dummySalt;
  const candidate=await passwordHash(password,nonce);
  return Boolean(stored && stored.length===candidate.length && timingSafeEqual(Buffer.from(stored),Buffer.from(candidate)));
}

async function quota(sql,key,limit,seconds) {
  const [r]=await sql`INSERT INTO auth_limits (key_hash,hits,until_at)
    VALUES (${keyed(key)},1,now()+${seconds}::integer * interval '1 second')
    ON CONFLICT (key_hash) DO UPDATE SET
      hits=CASE WHEN auth_limits.until_at<=now() THEN 1 ELSE LEAST(auth_limits.hits+1,10000) END,
      until_at=CASE WHEN auth_limits.until_at<=now() THEN excluded.until_at ELSE auth_limits.until_at END
    RETURNING hits`;
  return r.hits<=limit;
}

async function limits(sql,ip,action,account,ipLimit,accountLimit) {
  const allowed=await quota(sql,'ip/'+action+'/'+ip,ipLimit,900);
  return allowed && await quota(sql,'account/'+action+'/'+account,accountLimit,900);
}

async function sendMail(email,otp) {
  const subject='Verify your NSCT Preparation Portal account';
  const text='Your NSCT Preparation Portal verification code is '+otp+'. It expires in 10 minutes. If you did not request this code, you can ignore this email.';
  if (process.env.GMAIL_USER || process.env.GMAIL_APP_PASSWORD) {
    if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) throw new Error('Incomplete Gmail configuration');
    const transporter=nodemailer.createTransport({service:'gmail',auth:{user:process.env.GMAIL_USER,
      pass:process.env.GMAIL_APP_PASSWORD.replace(/\s/g,'')},connectionTimeout:10000,greetingTimeout:10000,socketTimeout:12000});
    await transporter.sendMail({from:process.env.GMAIL_USER,to:email,subject,text});
    return;
  }
  if (!process.env.RESEND_API_KEY || !process.env.MAIL_FROM) throw new Error('Mail configuration unavailable');
  const response=await fetch('https://api.resend.com/emails',{
    method:'POST', headers:{Authorization:'Bearer '+process.env.RESEND_API_KEY,'Content-Type':'application/json'},
    body:JSON.stringify({from:process.env.MAIL_FROM,to:[email],subject,text}),
    signal:AbortSignal.timeout(10000)
  });
  if (!response.ok) throw new Error('Verification email unavailable');
}

export async function authenticate(req,sql) {
  const raw=readCookie(req,'session');
  if (!raw) return null;
  const key=digest(raw);
  const [user]=await sql`SELECT u.id,u.name,u.cms,u.email,u.admin,s.expires_at
    FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=${key} AND s.expires_at>now()`;
  if (!user) return null;
  if (new Date(user.expires_at).getTime()-Date.now()<60*86400000) {
    const renewed=await sql`UPDATE sessions SET expires_at=now()+interval '90 days'
      WHERE token_hash=${key} AND expires_at>now() RETURNING user_id`;
    if (!renewed.length) return null;
    renewals.set(req,raw);
  }
  delete user.expires_at;
  return user;
}

export function withSessionRenewal(req,response) {
  const raw=renewals.get(req);
  if (raw) setCookie(req,response,'session',raw,sessionAge);
  return response;
}

async function startSession(req,sql,user) {
  const raw=token();
  await sql`INSERT INTO sessions (token_hash,user_id,expires_at) VALUES (${digest(raw)},${user.id},now()+interval '90 days')`;
  const response=reply({user});
  setCookie(req,response,'session',raw,sessionAge);
  setCookie(req,response,'pending','',0);
  return response;
}

export function createAuthRoutes({sendCode=sendMail}={}) {
  async function deliver(email,otp) {
    try {await sendCode(email,otp); return true;}
    catch (error) {
      console.error('OTP delivery failed',process.env.GMAIL_USER?'gmail':'mail',error.responseCode || error.code || error.name);
      return false;
    }
  }
  return async function handleAuth(action,body,req,sql,clientIp) {
    const ip=clientIp || req.headers.get('x-nf-client-connection-ip') || 'unknown';
    const cms=cmsValue(body.cms), email=emailValue(body.email);
    const limited=()=>failure('Too many requests. Try again in 15 minutes.',429);
    const expired=()=>failure('Start registration again to get a new verification code.',410);
    const deliveryFailed=()=>failure('We could not send your verification email. Try again later or use Contact us below.',503);
    if (randomInt(64)===0) {
      await sql`DELETE FROM auth_limits WHERE until_at<=now()`;
      await sql`DELETE FROM sessions WHERE expires_at<=now()`;
      await sql`DELETE FROM registrations WHERE expires_at<=now()`;
    }

    if (action==='register') {
      const name=typeof body.name==='string'?body.name.trim():'';
      if (!name || name.length>120 || !validEmail(email) || !validCms(cms) || !validPassword(body.password))
        return failure('Enter a name, valid email and CMS number, and a password between 12 and 128 characters.',400);
      if (!await limits(sql,ip,'register',email,30,5)) return limited();
      const existing=await sql`SELECT 1 FROM users WHERE cms=${cms} OR email=${email} LIMIT 1`;
      if (existing.length) return failure('This email or CMS number is already registered. Sign in with your CMS number.',409);
      const raw=token(), key=digest(raw), otp=code(), hash=await passwordHash(body.password);
      await sql`INSERT INTO registrations (token_hash,name,cms,email,password_hash,code_hash,code_expires_at,expires_at)
        VALUES (${key},${name},${cms},${email},${hash},${keyed(key+'/'+otp)},now()+interval '10 minutes',now()+interval '1 hour')`;
      if (!await deliver(email,otp)) {
        await sql`DELETE FROM registrations WHERE token_hash=${key}`;
        return deliveryFailed();
      }
      const response=reply({verificationRequired:true,email});
      setCookie(req,response,'pending',raw,3600);
      return response;
    }

    if (action==='verify' || action==='resend') {
      const raw=readCookie(req,'pending');
      if (!raw || !validEmail(email)) return expired();
      const key=digest(raw);
      if (!await limits(sql,ip,action,email,60,action==='verify'?15:4)) return limited();
      if (action==='resend') {
        const next=code();
        const updated=await sql`UPDATE registrations SET sent_at=now() WHERE token_hash=${key} AND email=${email}
          AND expires_at>now() AND sent_at<=now()-interval '60 seconds' RETURNING email`;
        if (!updated.length) {
          const pending=await sql`SELECT 1 FROM registrations WHERE token_hash=${key} AND email=${email} AND expires_at>now()`;
          return pending.length?failure('Wait a minute before requesting another code.',429):expired();
        }
        if (!await deliver(email,next)) return deliveryFailed();
        const replaced=await sql`UPDATE registrations SET code_hash=${keyed(key+'/'+next)},code_expires_at=now()+interval '10 minutes',tries=0
          WHERE token_hash=${key} AND email=${email} AND expires_at>now() RETURNING email`;
        if (!replaced.length) return expired();
        return reply({verificationRequired:true,email});
      }
      const otp=body.code ?? body.otp;
      if (typeof otp!=='string' || !/^\d{6}$/.test(otp)) return failure('Enter the six-digit verification code.',400);
      const challenge=keyed(key+'/'+otp);
      const [pending]=await sql`UPDATE registrations SET tries=tries+1 WHERE token_hash=${key} AND email=${email}
        AND expires_at>now() AND code_expires_at>now() AND tries<5 RETURNING code_hash`;
      if (!pending || pending.code_hash!==challenge)
        return failure('Code invalid or expired. Request a new code or start registration again.',400);
      const [user]=await sql`WITH claimed AS (
        DELETE FROM registrations WHERE token_hash=${key} AND email=${email} AND code_hash=${challenge}
          AND expires_at>now() AND code_expires_at>now() RETURNING name,cms,email,password_hash
        ) INSERT INTO users(name,cms,email,password_hash) SELECT name,cms,email,password_hash FROM claimed
        ON CONFLICT DO NOTHING RETURNING id,name,cms,email,admin`;
      if (!user) return failure('Registration could not be completed. Sign in if you already have an account.',409);
      return startSession(req,sql,user);
    }

    if (action==='login') {
      const denied=()=>failure('CMS number or password is incorrect.',401);
      if (!validCms(cms) || !validPassword(body.password)) return denied();
      if (!await limits(sql,ip,'login',cms,120,12)) return limited();
      const [user]=await sql`SELECT id,name,cms,email,admin,password_hash FROM users WHERE cms=${cms}`;
      if (!await matches(body.password,user?.password_hash)) return denied();
      delete user.password_hash;
      return startSession(req,sql,user);
    }

    if (action==='logout') {
      const raw=readCookie(req,'session');
      if (raw) await sql`DELETE FROM sessions WHERE token_hash=${digest(raw)}`;
      const response=reply({ok:true});
      setCookie(req,response,'session','',0);
      setCookie(req,response,'pending','',0);
      return response;
    }
    return failure('Page not found.',404);
  };
}
export const authRoute=createAuthRoutes();
