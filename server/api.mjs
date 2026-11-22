import {subjects,generate,present,summary,record,RequestError} from './papers.mjs';
import {authenticate,authRoute,withSessionRenewal} from './auth.mjs';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const authActions = new Set(['register','verify','resend','login','logout','saveProfile','changePassword','forgotPassword','verifyReset','resetPassword']);
const json = (data,status=200) => Response.json(data,{status,headers:{'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
const stored = a => JSON.stringify({...a,...summary(a)});

async function start(body,bank,user,sql) {
  await sql`INSERT INTO practice_usage (user_id) VALUES (${user.id}) ON CONFLICT DO NOTHING`;
  for (let retry=0;retry<5;retry++) {
    const [row]=await sql`SELECT counts,version FROM practice_usage WHERE user_id=${user.id}`;
    const attempt=generate(body,bank,row.counts);
    const rows=await sql`WITH claimed AS (
      UPDATE practice_usage SET counts=${JSON.stringify(row.counts)}::jsonb,version=version+1
      WHERE user_id=${user.id} AND version=${row.version} RETURNING user_id
    ) INSERT INTO attempts (id,user_id,state) SELECT ${attempt.id}::uuid,user_id,${stored(attempt)}::jsonb FROM claimed RETURNING id`;
    if (rows.length) return present(attempt);
  }
  throw new RequestError(409,'Another paper is starting. Please retry.');
}

async function attemptAction(action,body,user,sql) {
  if (!uuid.test(body.id)) throw new RequestError(404,'Paper not found.');
  for (let retry=0;retry<5;retry++) {
    const [row]=await sql`SELECT state,version FROM attempts WHERE id=${body.id} AND user_id=${user.id}`;
    if (!row) throw new RequestError(404,'Paper not found.');
    if (action==='get') return present(row.state);
    record(row.state,action,body);
    const changed=await sql`UPDATE attempts SET state=${stored(row.state)}::jsonb,version=version+1
      WHERE id=${body.id} AND user_id=${user.id} AND version=${row.version} RETURNING id`;
    if (changed.length) return present(row.state);
  }
  throw new RequestError(409,'Your paper changed on another device. Reload and retry.');
}

export function makeHandler({sql,bank,handleAuth=authRoute}) {
  return async function handle(req,context={}) {
    try {
      if (req.method!=='POST') return json({error:'Use POST.'},405);
      const origin=req.headers.get('origin');
      if ((origin && origin!==new URL(req.url).origin) || req.headers.get('sec-fetch-site')==='cross-site') return json({error:'Request origin refused.'},403);
      if (req.headers.get('content-type')?.split(';')[0]!=='application/json') return json({error:'Send a JSON request.'},415);
      if (Number(req.headers.get('content-length'))>8192) return json({error:'Request too large.'},413);
      const raw=await req.text();
      if (raw.length>8192) return json({error:'Request too large.'},413);
      let body;
      try {body=JSON.parse(raw);} catch {return json({error:'Invalid JSON.'},400);}
      if (!body || typeof body!=='object' || Array.isArray(body)) return json({error:'Invalid request.'},400);
      const action=new URL(req.url).pathname.split('/').pop();
      if (authActions.has(action)) return await handleAuth(action,body,req,sql,context.ip);
      if (action==='institutions') {
        const rows=await sql`SELECT name FROM institution_directory ORDER BY key`;
        return json({names:rows.map(row=>row.name)});
      }
      const user=await authenticate(req,sql);
      if (user && ['me','start','get','answer','finish','list'].includes(action)) {
        await sql`INSERT INTO student_activity (user_id) VALUES (${user.id})
          ON CONFLICT (user_id) DO UPDATE SET last_seen_at=now()
          WHERE student_activity.last_seen_at < now() - interval '1 minute'`;
      }
      const respond=data=>withSessionRenewal(req,json(data));
      if (action==='me' || action==='start' || action==='admin') {
        if (action!=='me' && !user) return json({error:'Please sign in.'},401);
        if (action==='admin' && !user.admin) return json({error:'Administrator access required.'},403);
        const overrides=await sql`SELECT question_id FROM question_overrides WHERE disabled`;
        const disabled=new Set(overrides.map(r=>r.question_id));
        const available=bank.filter(q=>!disabled.has(q.id));
        if (action==='me') return respond({user,subjects:subjects.map(s=>({...s,count:available.filter(q=>q.subject===s.id).length}))});
        if (action==='start') return respond({attempt:await start(body,available,user,sql)});
        const students=await sql`SELECT u.id,u.name,u.email,u.institution,count(a.id)::int AS attempts,
          activity.last_seen_at AS "lastActiveAt" FROM users u LEFT JOIN attempts a ON a.user_id=u.id
          LEFT JOIN student_activity activity ON activity.user_id=u.id GROUP BY u.id,activity.last_seen_at ORDER BY u.name,u.email`;
        return respond({students,totalStudents:students.length,totalAttempts:students.reduce((n,s)=>n+s.attempts,0),
          questions:bank.map(({id,stem,subject})=>({id,stem,subject,disabled:disabled.has(id)}))});
      }
      if (!user) return json({error:'Please sign in.'},401);
      if (action==='adminStudent' || action==='adminAttempt') {
        if (!user.admin) return json({error:'Administrator access required.'},403);
        if (!uuid.test(body.id)) return json({error:'Record not found.'},404);
        if (action==='adminStudent') {
          const [student]=await sql`SELECT u.id,u.name,u.institution,u.email,activity.last_seen_at AS "lastActiveAt" FROM users u LEFT JOIN student_activity activity ON activity.user_id=u.id WHERE u.id=${body.id}`;
          if (!student) return json({error:'Student not found.'},404);
          const rows=await sql`SELECT state - 'questions' AS info FROM attempts WHERE user_id=${student.id} ORDER BY created_at DESC`;
          return respond({student,attempts:rows.map(r=>r.info)});
        }
        const [row]=await sql`SELECT a.state,u.name,u.id AS student_id FROM attempts a JOIN users u ON u.id=a.user_id WHERE a.id=${body.id}`;
        if (!row) return json({error:'Paper not found.'},404);
        return respond({attempt:{...present(row.state),studentId:row.student_id,studentName:row.name}});
      }
      if (action==='list') {
        const rows=await sql`SELECT state - 'questions' AS info FROM attempts WHERE user_id=${user.id} ORDER BY created_at DESC`;
        return respond({attempts:rows.map(r=>r.info)});
      }
      if (['answer','get','finish'].includes(action)) return respond({attempt:await attemptAction(action,body,user,sql)});
      if (action==='toggle') {
        if (!user.admin) return json({error:'Administrator access required.'},403);
        if (!bank.some(q=>q.id===body.id) || typeof body.disabled!=='boolean') return json({error:'Invalid question or status.'},400);
        await sql`INSERT INTO question_overrides (question_id,disabled) VALUES (${body.id},${body.disabled})
          ON CONFLICT (question_id) DO UPDATE SET disabled=excluded.disabled`;
        return respond({ok:true});
      }
      return json({error:'Page not found.'},404);
    } catch (e) {
      if (e instanceof RequestError) return json({error:e.message},e.status);
      console.error('Portal request failed',e.name,e.code || '');
      return json({error:'The portal service is unavailable. Please try again shortly.'},503);
    }
  };
}
