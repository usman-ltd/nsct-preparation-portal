import {createHash, createHmac, randomBytes, randomInt, scrypt, timingSafeEqual} from 'node:crypto';
import {promisify} from 'node:util';
import nodemailer from 'nodemailer';
import {verificationEmail} from './verification-email.mjs';

const derive = promisify(scrypt);
const settings = {N:32768, r:8, p:3, maxmem:64*1024*1024};
const renewals = new WeakMap();
const sessionAge = 90*86400;
const salt = () => randomBytes(16).toString('hex');
const token = () => randomBytes(32).toString('hex');
const digest = value => createHash('sha256').update(value).digest('hex');
const emailValue = value => typeof value==='string' ? value.trim().toLowerCase() : '';
const validEmail = value => value.length<=254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
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

async function sendMail(email,otp,purpose) {
  const message=verificationEmail(otp,purpose);
  if (process.env.GMAIL_APP_PASSWORD) {
    if (!process.env.GMAIL_USER) throw new Error('Incomplete Gmail configuration');
    const transporter=nodemailer.createTransport({service:'gmail',auth:{user:process.env.GMAIL_USER,
      pass:process.env.GMAIL_APP_PASSWORD.replace(/\s/g,'')},connectionTimeout:10000,greetingTimeout:10000,socketTimeout:12000});
    await transporter.sendMail({from:{name:'NSCT Preparation Portal',address:process.env.GMAIL_USER},to:email,...message});
    return;
  }
  if (!process.env.RESEND_API_KEY || !process.env.MAIL_FROM) throw new Error('Mail configuration unavailable');
  const response=await fetch('https://api.resend.com/emails',{
    method:'POST', headers:{Authorization:'Bearer '+process.env.RESEND_API_KEY,'Content-Type':'application/json'},
    body:JSON.stringify({from:process.env.MAIL_FROM,to:[email],...message}),
    signal:AbortSignal.timeout(10000)
  });
  if (!response.ok) throw new Error('Verification email unavailable');
}

export async function authenticate(req,sql) {
  const raw=readCookie(req,'session');
  if (!raw) return null;
  const key=digest(raw);
  const [user]=await sql`SELECT u.id,u.name,u.institution,u.email,u.admin,s.expires_at
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

async function startSession(req,sql,user,expectedHash=null) {
  const raw=token();
  const inserted=await sql`WITH credential AS (
    SELECT id FROM users WHERE id=${user.id} AND (${expectedHash}::text IS NULL OR password_hash=${expectedHash}) FOR SHARE
  ) INSERT INTO sessions(token_hash,user_id,expires_at) SELECT ${digest(raw)},id,now()+interval '90 days' FROM credential RETURNING user_id`;
  if (!inserted.length) return failure('Sign in again with your current password.',401);
  const response=reply({user});
  setCookie(req,response,'session',raw,sessionAge);
  setCookie(req,response,'pending','',0);
  return response;
}

export function createAuthRoutes({sendCode=sendMail}={}) {
  async function deliver(email,otp,purpose) {
    try {await sendCode(email,otp,purpose); return true;}
    catch (error) {
      console.error('OTP delivery failed',process.env.GMAIL_APP_PASSWORD?'gmail':'mail',error.responseCode || error.code || error.name);
      return false;
    }
  }
  return async function handleAuth(action,body,req,sql,clientIp) {
    const ip=clientIp || req.headers.get('x-nf-client-connection-ip') || 'unknown';
    const email=emailValue(body.email);
    const limited=()=>failure('Too many requests. Try again in 15 minutes.',429);
    const expired=()=>failure('Start registration again to get a new verification code.',410);
    const deliveryFailed=()=>failure('We could not send your verification email. Try again later or use Contact us below.',503);
    if (randomInt(64)===0) {
      await sql`DELETE FROM password_resets WHERE expires_at<=now()`;
      await sql`DELETE FROM auth_limits WHERE until_at<=now()`;
      await sql`DELETE FROM sessions WHERE expires_at<=now()`;
      await sql`DELETE FROM registrations WHERE expires_at<=now()`;
    }

    if (action==='forgotPassword') {
      if (!validEmail(email)) return failure('Enter a valid email address.',400);
      if (!await limits(sql,ip,action,email,30,5)) return limited();
      const raw=token(), key=digest(raw), otp=code();
      const rows=await sql`INSERT INTO password_resets(user_id,token_hash,code_hash,password_version,expires_at)
        SELECT id,${key},${keyed('reset/'+key+'/'+otp)},md5(password_hash),now()+interval '10 minutes'
        FROM users WHERE email=${email}
        ON CONFLICT (user_id) DO UPDATE SET token_hash=excluded.token_hash,code_hash=excluded.code_hash,
          password_version=excluded.password_version,expires_at=excluded.expires_at,tries=0 RETURNING user_id`;
      if (rows.length && !await deliver(email,otp,'reset')) {
        await sql`DELETE FROM password_resets WHERE token_hash=${key}`;
        return deliveryFailed();
      }
      const response=reply({ok:true});
      setCookie(req,response,'reset',raw,600);
      return response;
    }

    if (action==='verifyReset') {
      const raw=readCookie(req,'reset');
      const invalid=()=>failure('Invalid or expired code. Request a new code if needed.',400);
      if (!raw || typeof body.otp!=='string' || !/^\d{6}$/.test(body.otp)) return invalid();
      const key=digest(raw), grant=token();
      if (!await limits(sql,ip,action,key,60,10)) return limited();
      const proof=keyed('reset/'+key+'/'+body.otp);
      const [row]=await sql`UPDATE password_resets SET tries=tries+1,
        token_hash=CASE WHEN code_hash=${proof} THEN ${digest(grant)} ELSE token_hash END,
        code_hash=CASE WHEN code_hash=${proof} THEN NULL ELSE code_hash END
        WHERE token_hash=${key} AND code_hash IS NOT NULL AND expires_at>now() AND tries<5
        RETURNING code_hash IS NULL AS verified`;
      if (!row?.verified) return invalid();
      const response=reply({ok:true});
      setCookie(req,response,'reset',grant,600);
      return response;
    }

    if (action==='saveProfile') {
      const user=await authenticate(req,sql);
      if (!user) return failure('Sign in to edit your profile.',401);
      const name=typeof body.name==='string'?body.name.trim():'';
      if (!name || name.length>120) return failure('Enter a full name of up to 120 characters.',400);
      await sql`UPDATE users SET name=${name} WHERE id=${user.id}`;
      return withSessionRenewal(req,reply({ok:true}));
    }

    if (action==='changePassword' || action==='resetPassword') {
      if (!validPassword(body.newPassword) || body.newPassword!==body.confirmPassword)
        return failure('Enter matching new passwords of 12 to 128 characters.',400);
      let id, version, keep='';
      if (action==='changePassword') {
        const user=await authenticate(req,sql);
        if (!user) return failure('Sign in to change your password.',401);
        if (!await limits(sql,ip,action,user.id,60,10)) return limited();
        const [current]=await sql`SELECT password_hash FROM users WHERE id=${user.id}`;
        if (!validPassword(body.oldPassword) || !await matches(body.oldPassword,current?.password_hash))
          return failure('Your current password is incorrect.',400);
        id=user.id;
        version=current.password_hash;
        keep=digest(readCookie(req,'session'));
      }
      const resetKey=digest(readCookie(req,'reset') || '');
      if (action==='resetPassword') {
        const [grant]=await sql`SELECT u.id,u.password_hash FROM password_resets r JOIN users u ON u.id=r.user_id
          WHERE r.token_hash=${resetKey} AND r.code_hash IS NULL AND r.expires_at>now() AND r.password_version=md5(u.password_hash)`;
        if (!grant) return failure('Request a new password reset code.',410);
        id=grant.id;
        version=grant.password_hash;
      }
      const hash=await passwordHash(body.newPassword);
      const changed=await sql`WITH changed AS (
        UPDATE users SET password_hash=${hash} WHERE id=${id} AND password_hash=${version}
        AND (${action}='changePassword' OR EXISTS (SELECT 1 FROM password_resets
          WHERE user_id=${id} AND token_hash=${resetKey} AND code_hash IS NULL AND expires_at>now() FOR UPDATE))
        RETURNING id
      ), revoked AS (DELETE FROM sessions USING changed WHERE user_id=changed.id AND token_hash<>${keep}),
      cleared AS (DELETE FROM password_resets USING changed WHERE user_id=changed.id)
      SELECT id FROM changed`;
      if (!changed.length) return failure('Your credentials changed. Please start again.',409);
      const response=reply({ok:true});
      setCookie(req,response,'reset','',0);
      return withSessionRenewal(req,response);
    }

    if (action==='register') {
      const institution=typeof body.institution==='string'?body.institution.trim().replace(/\s+/g,' '):'';
      const name=typeof body.name==='string'?body.name.trim():'';
      if (!name || name.length>120 || !validEmail(email) || (!institution || institution.length>250) || !validPassword(body.password))
        return failure('Enter a name, valid email, university or college, and a password between 12 and 128 characters.',400);
      if (!await limits(sql,ip,'register',email,30,5)) return limited();
      const existing=await sql`SELECT 1 FROM users WHERE email=${email} LIMIT 1`;
      if (existing.length) return failure('This email is already registered. Sign in with your email address.',409);
      const raw=token(), key=digest(raw), otp=code(), hash=await passwordHash(body.password);
      await sql`INSERT INTO registrations (token_hash,name,institution,share_institution,email,password_hash,code_hash,code_expires_at,expires_at)
        VALUES (${key},${name},${institution},${body.shareInstitution==="yes"},${email},${hash},${keyed(key+'/'+otp)},now()+interval '10 minutes',now()+interval '1 hour')`;
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
          AND expires_at>now() AND code_expires_at>now() RETURNING name,institution,email,password_hash,share_institution
        ), created AS (INSERT INTO users(name,institution,email,password_hash) SELECT name,institution,email,password_hash FROM claimed
        ON CONFLICT DO NOTHING RETURNING id,name,institution,email,admin
        ), shared AS (INSERT INTO institution_directory(key,name)
          SELECT lower(created.institution),created.institution FROM created JOIN claimed USING(email)
          WHERE claimed.share_institution ON CONFLICT (key) DO NOTHING)
        SELECT * FROM created`;
      if (!user) return failure('Registration could not be completed. Sign in if you already have an account.',409);
      return startSession(req,sql,user);
    }

    if (action==='login') {
      const denied=()=>failure('Email address or password is incorrect.',401);
      if (!validEmail(email) || !validPassword(body.password)) return denied();
      if (!await limits(sql,ip,'login',email,120,12)) return limited();
      const [user]=await sql`SELECT id,name,institution,email,admin,password_hash FROM users WHERE email=${email}`;
      if (!await matches(body.password,user?.password_hash)) return denied();
      const {password_hash,...account}=user;
      return startSession(req,sql,account,password_hash);
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
