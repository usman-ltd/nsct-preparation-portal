import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {openLocal} from './local-db.mjs';
const email=process.argv[2]?.trim();
if (!email) throw Error('Usage: npm run local:admin -- <registered email address> (stop the local server first)');
const {db,sql}=await openLocal(process.env.NSCT_LOCAL_STATE ? resolve(process.env.NSCT_LOCAL_STATE,'pg') : fileURLToPath(new URL('../.local/pg',import.meta.url)));
try {
  const rows=await sql`UPDATE users SET admin=true WHERE upper(email)=upper(${email}) RETURNING id`;
  if (!rows.length) throw Error('No verified local account matched that email address.');
  console.log('Local administrator access granted.');
} finally {await db.close();}
