import {neon} from '@neondatabase/serverless';
import {makeHandler} from '../../server/api.mjs';
import bank from '../../data/bank.json' with {type:'json'};
export const config={path:'/api/:action'};
import {ensureIdentitySchema} from '../../server/identity-schema.mjs';
let ready;
async function initialize() {
  const sql=neon(process.env.DATABASE_URL);
  await ensureIdentitySchema(sql);
  return makeHandler({sql,bank});
}
export default async function(req,context) {
  if (!process.env.DATABASE_URL || !process.env.AUTH_SECRET) {
    return Response.json({error:'The portal services have not been configured.'},{status:503,headers:{'Cache-Control':'no-store'}});
  }
  ready ??= initialize().catch(error => { ready=undefined; throw error; });
  const handle=await ready;
  return handle(req,context);
}
