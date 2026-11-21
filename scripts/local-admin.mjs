import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {openLocal} from './local-db.mjs';
const cms=process.argv[2]?.trim();
if (!cms) throw Error('Usage: npm run local:admin -- <registered CMS number> (stop the local server first)');
const {db,sql}=await openLocal(process.env.NSCT_LOCAL_STATE ? resolve(process.env.NSCT_LOCAL_STATE,'pg') : fileURLToPath(new URL('../.local/pg',import.meta.url)));
try {
  const rows=await sql`UPDATE users SET admin=true WHERE upper(cms)=upper(${cms}) RETURNING id`;
  if (!rows.length) throw Error('No verified local account matched that CMS number.');
  console.log('Local administrator access granted.');
} finally {await db.close();}
