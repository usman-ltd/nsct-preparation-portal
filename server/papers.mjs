import { randomInt, randomUUID } from 'node:crypto';

export const subjects = [
  ['ps','Problem Solving & Analytical Skills',20], ['prog','Programming',10],
  ['dsa','Data Structures & Algorithms',10], ['db','Databases',10],
  ['se','Software Engineering',10], ['web','Web Development',10],
  ['net','Computer Networks & Cloud Computing',10], ['ai','AI, ML & Data Analytics',10],
  ['os','Operating Systems',5], ['cyber','Cyber Security',5]
].map(([id,name,weight]) => ({id,name,weight}));

export class RequestError extends Error {
  constructor(status,message) { super(message); this.status = status; }
}

export function shuffle(values) {
  const copy = [...values];
  for (let end = copy.length - 1; end > 0; end--) {
    const next = randomInt(end + 1);
    [copy[end],copy[next]] = [copy[next],copy[end]];
  }
  return copy;
}

export function quota(size, selected) {
  const total = selected.reduce((sum,s) => sum + s.weight,0);
  const rows = selected.map(s => ({id:s.id, count:Math.floor(size*s.weight/total), remainder:(size*s.weight)%total}));
  const left = size - rows.reduce((sum,s) => sum+s.count,0);
  for (const row of [...rows].sort((a,b) => b.remainder-a.remainder).slice(0,left)) row.count++;
  return rows;
}

export function generate(body,bank,usage) {
  const {mode,size} = body;
  if (!['exam','learn'].includes(mode) || ![20,50,100].includes(size)) throw new RequestError(400,'Choose an available paper length and feedback mode.');
  if (!Array.isArray(body.subjects) || !body.subjects.length || body.subjects.some(id => !subjects.some(s => s.id===id))) throw new RequestError(400,'Choose at least one available subject.');
  const selected = subjects.filter(s => body.subjects.includes(s.id));
  const questions = [];
  for (const {id,count} of quota(size,selected)) {
    const pool = shuffle(bank.filter(q => q.subject===id));
    if (pool.length < count) throw new RequestError(422,'The selected subjects have too few available questions for that length.');
    pool.sort((a,b) => (usage[a.id] || 0) - (usage[b.id] || 0));
    for (const q of pool.slice(0,count)) {
      const order = shuffle(q.options.map((_,i) => i));
      questions.push({key:q.id,subject:id,stem:q.stem,options:order.map(i=>q.options[i]),
        correct:order.indexOf(q.correct),explanations:order.map(i=>q.explanations[i]),choice:null});
      usage[q.id] = (usage[q.id] || 0)+1;
    }
  }
  return {id:randomUUID(),createdAt:new Date().toISOString(),completedAt:null,subjects:selected.map(s=>s.id),size,mode,completed:false,questions:shuffle(questions)};
}

export function summary(a) {
  const answered = a.questions.filter(q=>q.choice!==null).length;
  const score = a.completed ? a.questions.filter(q=>q.choice===q.correct).length : null;
  return {id:a.id,mode:a.mode,size:a.size,answered,score,completed:a.completed,createdAt:a.createdAt,updatedAt:a.updatedAt || a.createdAt,completedAt:a.completedAt || null,subjects:a.subjects};
}

const formatLabels = new Set([
  "calculation", "calculation / logic", "calculation / stats", "calculation/comparison",
  "calculation/logic", "calculation/math", "code error / debugging", "code error / logic",
  "code output", "code output / bitwise", "code output / logic", "code output / regex",
  "code-analysis", "code-logic / data", "code-logic / markdown", "code-logic / sql", "code-math",
  "code-tracing", "code-tracing / c++", "code-tracing / calculation", "code-tracing / java",
  "code-tracing / java logic", "code-tracing / logic", "code/console logic", "code/data tracing",
  "code/logic", "code/logic tracing", "comparison", "conceptual", "debugging",
  "debugging / casting", "debugging / error analysis", "debugging / logic", "debugging / regex",
  "debugging / scenario", "debugging/analysis", "diagram/visual interpretation",
  "logic/calculation", "logic/schema", "mathematical", "notation-tracing", "scenario based",
  "scenario-based", "technique",
]);

export function present(a) {
  return {...summary(a),questions:a.questions.map(({subject,stem,options,choice,correct,explanations}) => {
    // The imported bank labels question formats before the actual prompt.
    const prompt = stem.replace(/^\s*\(([^)]+)\)\s*/, (prefix, label) =>
      formatLabels.has(label.trim().toLowerCase()) ? '' : prefix);
    const row = {subject,stem:prompt,options,choice};
    return a.completed || (a.mode==='learn' && choice!==null) ? {...row,correct,explanations} : row;
  })};
}

export function record(a,action,{index,choice}) {
  if (action==='finish' && a.completed) return;
  if (a.completed) throw new RequestError(409,'This paper has already been submitted.');
  if (action==='finish') {
    if (a.questions.some(q=>q.choice===null)) throw new RequestError(409,'Answer each question before submitting.');
    a.completed=true;
    a.completedAt=a.updatedAt=new Date().toISOString();
    return;
  }
  if (!Number.isInteger(index) || !a.questions[index] || !Number.isInteger(choice) || choice<0 || choice>=a.questions[index].options.length) throw new RequestError(400,'Choose a valid answer.');
  const q=a.questions[index];
  if (a.mode==='learn' && q.choice!==null && q.choice!==choice) throw new RequestError(409,'This answer is locked.');
  q.choice=choice;
  a.updatedAt=new Date().toISOString();
}
