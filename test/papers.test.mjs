import test from 'node:test';
import assert from 'node:assert/strict';
import bank from '../data/bank.json' with {type:'json'};
import {subjects,generate,quota,present,record} from '../server/papers.mjs';

test('HEC quotas, shuffled answer mapping and fairness across selected papers',()=>{
  assert.deepEqual(quota(100,subjects).map(q=>q.count),[20,10,10,10,10,10,10,10,5,5]);
  assert.deepEqual(quota(50,subjects).map(q=>q.count),[10,5,5,5,5,5,5,5,3,2]);
  const pool=bank.filter(q=>q.subject==='db'), usage={};
  const lookup=new Map(pool.map(q=>[q.id,q]));
  for(let n=0;n<Math.ceil(pool.length/20)+2;n++){
    const paper=generate({subjects:['db'],mode:'learn',size:20},bank,usage);
    assert.equal(new Set(paper.questions.map(q=>q.key)).size,20);
    const counts=pool.map(q=>usage[q.id]||0);
    assert(Math.max(...counts)-Math.min(...counts)<=1);
    for(const q of paper.questions) {
      const source=lookup.get(q.key);
      assert.equal(q.options[q.correct],source.options[source.correct]);
      q.options.forEach((o,i)=>assert.equal(q.explanations[i],source.explanations[source.options.indexOf(o)]));
    }
  }
});
test('learning locks the first choice; exam keys stay private through revision',()=>{
  for(const mode of ['learn','exam']){
    const paper=generate({subjects:['db'],mode,size:20},bank,{});
    assert(!('correct' in present(paper).questions[0]));
    assert.throws(()=>record(paper,'finish',{}));
    record(paper,'answer',{index:0,choice:0});
    if(mode==='learn'){
      assert('explanations' in present(paper).questions[0]);
      assert.throws(()=>record(paper,'answer',{index:0,choice:1}));
    }else{
      assert(!('correct' in present(paper).questions[0]));
      record(paper,'answer',{index:0,choice:1});
    }
    paper.questions.forEach((q,index)=>{if(q.choice===null)record(paper,'answer',{index,choice:q.correct});});
    record(paper,'finish',{});
    assert(present(paper).score>=19);
    assert(present(paper).questions.every(q=>q.explanations.length===4));
    assert.throws(()=>record(paper,'answer',{index:0,choice:2}));
  }
});
