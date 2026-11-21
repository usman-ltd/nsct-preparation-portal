import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';

import {ensureIdentitySchema} from '../server/identity-schema.mjs';

export async function openLocal(directory) {
  const db=new PGlite(directory);
  for (const filename of ['../db.sql','../server/practice.sql']) {
    await db.exec(await readFile(new URL(filename,import.meta.url),'utf8'));
  }
  const sql=async(parts,...values)=>{
    const query=parts.reduce((text,part,i)=>text+(i?'$'+i:'')+part,'');
    return (await db.query(query,values)).rows;
  };
  await ensureIdentitySchema(sql);
  return {db,sql};
}
