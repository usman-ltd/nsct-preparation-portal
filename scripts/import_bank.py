"""Regenerate private question data from the supplied PDFs and the vetted legacy HTML bank."""
import argparse
from collections import Counter, defaultdict
import hashlib
import json
from pathlib import Path
import re
import tempfile
import unicodedata

from pypdf import PdfReader

SUBJECTS = 'ps prog dsa db se web net ai os cyber'.split()
TOPICS = dict(zip(['Problem Solving & Analytical Skills','Programming (C++, Java, Python)','Data Structures & Algorithms','Databases','Software Engineering','Web Development','Computer Networks & Cloud','AI, ML & Data Analytics','Operating Systems','Cyber Security'], SUBJECTS))
HERE = Path(__file__).resolve().parent
OUT = HERE.parent / 'data'
QUESTION = re.compile(r'^Q\s*(\d+)[.):]\s*(.*)', re.I)
OPTION = re.compile(r'^([ABCD])[).]\s*(.*)')
# Source passages with operational intrusion steps are set aside for editorial review.
HOLD = re.compile(r"""(?:<script>.*alert|['"]\s*(?:OR|UNION)\s+(?:1\s*=|'1'\s*=|SELECT\b)|(?:nmap|netcat|nc|sqlmap|aircrack-ng|msfconsole)\s+-|/etc/shadow|/bin/(?:ba)?sh|reverse shell|shellcode|exploit payload|\.\./\.\./|document\.cookie|javascript:alert|buffer overflow.{0,100}return address|return address.{0,100}buffer overflow)""",re.I|re.S)


def lines(path):
    # Cache extraction in the task host's temporary directory, keyed by source content.
    cache = Path(tempfile.gettempdir()) / ('nsct-bank-v4-' + hashlib.sha256(path.read_bytes()).hexdigest() + '.json')
    if cache.exists():
        return json.loads(cache.read_text(encoding='utf8'))
    result = []
    for page_no,page in enumerate(PdfReader(path).pages, 1):
        runs=[]
        def visit(text, cm, tm, font, size):
            if text.strip() and font:
                runs.append((tm[5], tm[4], text.strip('\r\n'), str(font.get('/BaseFont','')),size))
        page.extract_text(visitor_text=visit)
        groups=[]
        for y,x,txt,font,size in sorted(runs,key=lambda r:(r[0],r[1])):
            if not groups or y-groups[-1][0]>2.3:
                groups.append((y,[]))
            groups[-1][1].append((x,txt,font,size))
        for _,group in groups:
            group.sort(key=lambda r:r[0])
            x,_,font,size=group[0]
            pieces=[]
            for position,(start,txt,face,pt) in enumerate(group):
                if position and 'Mono' in group[position-1][2] and 'Mono' in face:
                    last,word,_,last_pt=group[position-1]
                    space=last_pt*0.602
                    missing=round((start-last)/space)-len(word)
                    if missing>0:
                        pieces.append(' '*missing)
                pieces.append(txt)
            result.append([page_no,round(x,1),size,'Bold' in font, ''.join(pieces).strip()])
    cache.write_text(json.dumps(result,ensure_ascii=False),encoding='utf8')
    return result


def normalized(text):
    return ' '.join(unicodedata.normalize('NFKC',text).casefold().split()).rstrip('.?! ')


def extract(path,subject,review):
    rows=[]
    sections=[]
    for page,x,size,bold,text in lines(path):
        match=QUESTION.match(text)
        if match:
            sections.append([page,match[1],[(x,size,bold,match[2])]])
        elif sections:
            sections[-1][2].append((x,size,bold,text))
    for index,(page,num,parts) in enumerate(sections,1):
        stem=[]; options=[]; explanation=[]; keys=[]
        for x,size,bold,text in parts:
            if len(options)==4 and (explanation or size<15 and abs(x-(parts[0][0]+16))<0.5):
                if size>=16 or x < parts[0][0]+15 or text=='•':
                    break
                explanation.append(text)
                continue
            m=OPTION.match(text)
            if m and ord(m[1])-65==len(options):
                if bold:
                    keys.append(len(options))
                options.append(m[2])
            elif options:
                options[-1]+=' '+text
            else:
                # Keep code on separate lines to retain question context.
                indent=max(0, round((x-parts[0][0]-15)/(size*0.602))) if size==14 else 0
                stem.append(('\n'+' '*indent if size<15 else ' ')+text)
        stem=''.join(stem).strip()
        rationale=' '.join(explanation).strip()
        qid=f'{subject}-{index:03}'
        reason=None
        if len(options)!=4 or len(keys)!=1 or not all(options) or not rationale:
            reason='incomplete choices, answer marking, or explanation'
        if len(set(map(normalized,options)))!=4:
            reason='equivalent choices'
        if HOLD.search(' '.join([stem,*options,rationale])):
            reason='requires editorial review'
        source=f'{path.name} · p. {page} · Q{num}'
        if reason:
            review.append([qid,source,reason])
        else:
            rows.append(dict(id=qid,subject=subject,stem=stem,options=options,correct=keys[0],rationale=rationale,source=source))
    return rows


def legacy(path,review):
    html=path.read_text(encoding='utf8')
    questions=json.JSONDecoder().raw_decode(html.partition('const BANK=')[2])[0]
    result=[]
    for q in questions:
        source=f'NSCT_400_Domain_Wise_Questions_With_Answers.pdf · p. {q["p"]} · Q{q["id"]}'
        if len(q['o'])!=4 or len(set(map(normalized,q['o'])))!=4 or not 0<=q['a']<4:
            review.append([f'legacy-{q["id"]}',source,'ambiguous legacy record'])
            continue
        result.append(dict(id=f'legacy-{q["id"]}',subject=TOPICS[q['topic']],stem=q['q'],options=q['o'],correct=q['a'],rationale=q.get('why',''),originalWrong=q.get('wrong',[]),source=source))
    return result


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('pdf_directory',type=Path)
    parser.add_argument('legacy_html',type=Path,help='Path to the supplied NSCT_CS_2027_Practice_Studio_v3.html')
    args=parser.parse_args()
    review=[]
    rows=[]
    for path,subject in zip(sorted(args.pdf_directory.glob('NSCT_File_*.pdf')),SUBJECTS,strict=True):
        rows.extend(extract(path,subject,review))
        print(path.name,len(rows),flush=True)
    rows.extend(legacy(args.legacy_html,review))
    build(rows,review,args.pdf_directory)


def source_glossary(directory):
    glossary={}
    for path,subject in zip(sorted(directory.glob('NSCT_File_*.pdf')),SUBJECTS):
        note=False
        entries=[]
        for _,_,size,_,text in lines(path):
            if size>=16:
                note=text in ('Quick Notes','Quick Revision Cheat Sheet')
                continue
            if not note or size!=15:
                continue
            if '•' in text or '◦' in text:
                entries.append(re.sub(r'[•◦]', '', text))
            elif entries:
                entries[-1]+=' '+text
        for entry in entries:
            term,sep,definition=entry.partition(':')
            if sep and 1<len(term)<60 and 6<len(definition)<410 and not HOLD.search(entry):
                glossary.setdefault((subject,normalized(term)),definition.strip())
    return glossary


# Items with conflicting keys, multiple defensible answers, or operational scenarios.
FLAGGED = set('dsa-123 se-043 os-039 web-170 web-179 net-086 net-167 cyber-062 cyber-064 cyber-079 cyber-091 cyber-101 cyber-137'.split())
CLARIFIED = {
    71:'For which class of optimization problems are heuristics often used because exact solutions can be computationally expensive?',
    134:'Which Python mapping type guarantees that iterating its keys follows insertion order in Python 3.7 and later?',
    186:'Which depth-first traversal visits the root before recursively visiting its left and right subtrees?',
    226:'Which architecture divides an application into independently deployable services with network interfaces?',
    277:'Which architectural style exposes resources through a uniform interface using HTTP methods?',
    305:'Which metric reports the fraction of actual positive cases that the classifier identifies?',
    342:'Which of these database products is a document-oriented NoSQL database?',
    356:'Which type of thread is scheduled by a user-space runtime rather than directly by the kernel?',
    372:'Which memory-management scheme maps fixed-size virtual pages to physical frames?',
    395:'Which listed practice checks that data entered into a web form conforms to expected values and formats?'
}
KEY_FIXES={
    'prog-045':(0,'The remainder 10 % 3 equals 1. Addition gives 5 before the shift, and shifting 5 left by one bit gives 10.'),
    'se-191':(1,'Risk A has expected impact 0.1 × 90 = 9. Risk B has expected impact 0.6 × 10 = 6. Prioritizing by expected impact puts Risk A first.')
}
LEGACY_REASONS={
    3:'The terms are the squares of 1, 2, 3, and 4. The next term is 5 squared, or 25.',
    4:'Dividing both sides of 2x = 10 by 2 gives x = 5.',
    23:'Each term doubles the preceding term, so the next number is 16 × 2 = 32.',
    24:'Both 4 and −4 give 16 when squared.',
    43:'Each term is three times its predecessor, so the next number is 27 × 3 = 81.',
    44:'Greater-than is transitive. If A exceeds B and B exceeds C, then A exceeds C.',
    60:'The B elements that belong to C might all lie outside A. The premises do not establish an overlap between A and C.',
    61:'The terms are 1×2, 2×3, 3×4, and 4×5. The next product is 5×6 = 30.',
    62:'Adding the equations cancels y and gives 2x = 12, so x = 6.',
    106:'HTTPS uses port 443 by default. Other ports can be selected explicitly.',
    282:'In JavaScript, let and const create block-scoped bindings. A var binding belongs to the surrounding function or global scope.',
    286:'JSON is a common representation for structured resources exchanged by REST APIs. REST itself permits other media types.',
    293:'Convolutional and recurrent networks are neural network architectures, and all three listed types can have multiple processing layers.',
    326:'When training error stays low while validation error is high, the model is fitting its training examples more closely than it generalizes.',
    352:'In relational algebra, selection keeps rows that satisfy a predicate. Projection chooses columns.'
}


def build(rows,review,directory):
    glossary=source_glossary(directory)
    authored=dict(line.split('|',1) for line in (HERE/'import_glossary.txt').read_text(encoding='utf-8-sig').splitlines() if line)
    terms={normalized(k):v for k,v in authored.items()}
    terms['o(n)']='Linear work grows in proportion to the input size.'
    terms['o(log n)']='Logarithmic work grows by a constant amount when the input is multiplied by a fixed factor.'
    terms['o(n log n)']='Linearithmic work combines a linear factor with a logarithmic factor, as in comparison-based merge sort.'
    terms['o(n²)']='Quadratic work grows in proportion to the square of the input size.'
    def definition(subject,choice):
        term=normalized(choice)
        if term=='heap' and subject in ('prog','os'):
            return 'The memory heap holds dynamically allocated objects whose lifetimes can extend beyond a single call.'
        if term=='switch' and subject=='prog':
            return 'A switch statement dispatches control according to a value and its matching case.'
        if term=='delete':
            return {'web':'HTTP DELETE requests removal of the target resource.', 'prog':'In C++, delete destroys a dynamically allocated object and releases its storage.'}.get(subject,'SQL DELETE removes rows from a table.')
        if term in terms:
            return terms[term]
        if (subject,term) in glossary:
            return choice.rstrip('. ')+': '+glossary[subject,term]
        return None
    # Look up concepts mentioned within longer options using the source's own notes.
    catalogs={s:dict(terms) for s in SUBJECTS}
    for (subject,term),meaning in glossary.items():
        names=[term]
        alias=re.fullmatch(r'(.+?)\s*\(([^()]*)\)',term)
        if alias:
            names.extend(alias.groups())
        for name in names:
            if 3<=len(name)<=68 and len(meaning)>=12:
                catalogs[subject].setdefault(name,term.capitalize()+': '+meaning)
    for record in rows:
        term=record['options'][record['correct']].strip(' ."')
        why=record['rationale']
        if 2<len(term)<=50 and why and record['id'] not in FLAGGED:
            first=re.split(r'(?<=[.!?])\s+(?=[A-Z])',why,maxsplit=1)[0]
            if len(first)<360 and re.match(r'^(?:an? |the )?'+re.escape(term)+r'\s+(?:is|are|uses?|provides?|refers?|represents?|allows?|means?|occurs?|stores?|checks?|enables?|creates?|defines?|involves?)\b',first,re.I):
                catalogs[record['subject']].setdefault(normalized(term),first)
    broad=set('code cost size case data design system analysis graph error dynamic static testing performance implementation practice variable function class order input output value means example purpose model range application user types process tools'.split())
    patterns={}
    for subject,vocab in catalogs.items():
        keys=[k for k in vocab if k not in broad and (len(k)>3 or k in {'tcp','udp','dns','bfs','dfs','arp','ftp','vpn','sso','aes','rsa','ssd'})]
        patterns[subject]=re.compile(r'(?<![\w-])(?:'+'|'.join(re.escape(k) for k in sorted(keys,key=len,reverse=True))+r')(?![\w-])',re.I)
    fallback_count=0
    def feedback(subject,option,answer,rationale):
        nonlocal fallback_count
        key=re.sub(r'^(?:a |an |the )','',normalized(option).strip('"'))
        vocab=catalogs[subject]
        if key in vocab:
            return vocab[key]
        matches=patterns[subject].findall(key)
        if matches:
            term=max(matches,key=len).casefold()
            if term in vocab:
                return vocab[term]
        number=r'[+-]?(?:\d+(?:\.\d+)?|\.\d+)'
        if re.fullmatch(number,option) and re.fullmatch(number,answer):
            difference=float(option)-float(answer)
            if difference:
                direction='above' if difference>0 else 'below'
                return f'{option} is {abs(difference):g} {direction} the result. {rationale}'
        if re.search(r'no (?:functional )?difference|(?:same|identical|equal)(?: thing)?[.!]?$',option,re.I):
            return 'This choice treats the cases as equivalent. '+rationale
        sentences=re.split(r'(?<=[.!?])\s+(?=[A-Z0-9“"])',rationale)
        stop=set('only what without would that they their them which this with same more less other because every always when using both will than then from does into must value access server system data time used each'.split())
        words=set(re.findall(r'[a-z]{4,}',key))-stop
        evidence=[(len(words&set(re.findall(r'[a-z]{4,}',sent.casefold()))),sent) for sent in sentences]
        score,sentence=max(evidence,key=lambda pair:pair[0])
        if score>=2 and len(sentences)>1:
            return sentence
        fallback_count+=1
        return rationale

    bank=[]
    seen=set()
    for q in rows:
        id=q['id']
        reason=None
        if id in FLAGGED: reason='held for editorial review'
        if id.startswith('legacy-') and int(id[7:]) in CLARIFIED:
            q['stem']=CLARIFIED[int(id[7:])]
            q['source']+=' · wording clarified'
        key=normalized(q['stem'])
        if key in seen: reason='duplicate question text'
        if reason:
            review.append([id,q['source'],reason])
            continue
        seen.add(key)
        rationale=q.pop('rationale')
        if id in KEY_FIXES:
            q['correct'],rationale=KEY_FIXES[id]
            q['source']+=' · corrected against the worked calculation'
        opts=q['options']
        if id=='legacy-282':
            opts[3]='Both let and const'
        for i,value in enumerate(opts):
            value=re.sub(r'\ball of the above\b','All the other choices',value,flags=re.I)
            value=re.sub(r'\bnone of the above\b','None of the other choices',value,flags=re.I)
            m=re.fullmatch(r'[Bb]oth ([A-D]) (?:and|&) ([A-D])\.?',value)
            if m: value='Both '+opts[ord(m[1])-65]+' and '+opts[ord(m[2])-65]
            opts[i]=value
        if id!='ps-171':
            rationale=re.sub(r'\bOption ([ABCD])\b',lambda m:'“'+opts[ord(m[1])-65].rstrip('.')+'”',rationale,flags=0)
        if id.startswith('legacy'):
            rationale=LEGACY_REASONS.get(int(id[7:]),rationale)
        answer=opts[q['correct']]
        rationale=rationale or definition(q['subject'],answer)
        if not rationale:
            rationale=f'The source identifies “{answer}” as the answer to this question.'
        original_wrong=q.pop('originalWrong',[])
        explanations=[]
        for i,option in enumerate(opts):
            if i==q['correct']:
                explanations.append(rationale)
            else:
                desc=original_wrong[i] if len(original_wrong)==4 and original_wrong[i] else definition(q['subject'],option)
                if desc:
                    explanations.append(desc)
                else:
                    explanations.append(feedback(q['subject'],option,answer,rationale))
        q['explanations']=explanations
        bank.append(q)
    OUT.mkdir(exist_ok=True)
    (OUT/'bank.json').write_text(json.dumps(bank,ensure_ascii=False,separators=(',',':')),encoding='utf8')
    print('Imported',len(bank),dict(Counter(x['subject'] for x in bank)))
    print('Held records',len(review),dict(Counter(reason for _,_,reason in review)))
    report={'active':len(bank),'sharedRationaleDistractors':fallback_count,'bySubject':dict(Counter(x['subject'] for x in bank)),
            'legacyPreExcluded':[n for n in range(1,401) if not any(q['id']==f'legacy-{n}' for q in rows)],
            'held':[dict(id=id,source=source,reason=reason) for id,source,reason in review]}
    (OUT/'import-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf8')


if __name__=='__main__':
    main()





