import assert from 'node:assert/strict';
import bank from '../data/bank.json' with {type:'json'};
import {subjects,generate,quota} from '../server/papers.mjs';
import {readFile,access} from 'node:fs/promises';
const ids=new Set();
for(const q of bank){
  assert(!ids.has(q.id),'Duplicate id '+q.id);
  ids.add(q.id);
  assert(subjects.some(s=>s.id===q.subject) && q.stem?.trim() && q.source?.trim(),q.id);
  assert.equal(q.options.length,4,q.id);
  assert.equal(q.explanations.length,4,q.id);
  assert([...q.options,...q.explanations].every(s=>typeof s==='string' && s.trim()),q.id);
  assert(Number.isInteger(q.correct) && q.correct>=0 && q.correct<4,q.id);
}
for(const size of [20,50,100]){
  for(const scope of [subjects,...subjects.map(s=>[s]),subjects.filter(s=>['db','ai','dsa'].includes(s.id))]){
    const attempt=generate({size,mode:'exam',subjects:scope.map(s=>s.id)},bank,{});
    assert.equal(new Set(attempt.questions.map(q=>q.key)).size,size);
    for(const {id,count} of quota(size,scope)) assert.equal(attempt.questions.filter(q=>q.subject===id).length,count);
  }
}
for (const file of ['../public/index.html','../public/app.js','../public/riphah.jpg','../public/portal.css','../db.sql']) await access(new URL(file,import.meta.url));
const client=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
assert(!/DATABASE_URL|RESEND_API_KEY|AUTH_SECRET/.test(client));
console.log(bank.length+' bank entries and 36 paper configurations checked.');
