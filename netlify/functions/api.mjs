import {neon} from '@neondatabase/serverless';
import {makeHandler} from '../../server/api.mjs';
import bank from '../../data/bank.json' with {type:'json'};
export const config={path:'/api/:action'};
let handle;
export default async function(req,context) {
  if (!process.env.DATABASE_URL || !process.env.AUTH_SECRET || !process.env.RESEND_API_KEY || !process.env.MAIL_FROM) {
    return Response.json({error:'The portal services have not been configured.'},{status:503,headers:{'Cache-Control':'no-store'}});
  }
  handle ??= makeHandler({sql:neon(process.env.DATABASE_URL),bank});
  return handle(req,context);
}
