'use strict';
const fs=require('fs'),path=require('path');
const root=path.join(__dirname,'..','src');
function walk(dir,out=[]){for(const e of fs.readdirSync(dir,{withFileTypes:true})){const p=path.join(dir,e.name);if(e.isDirectory())walk(p,out);else if(e.isFile()&&e.name.endsWith('.js'))out.push(p);}return out;}
const files=walk(root), set=new Set(files.map(p=>path.resolve(p))), graph=new Map(files.map(p=>[path.resolve(p),[]]));
const rx=/require\(['"](\.{1,2}\/[^'"]+)['"]\)/g;
for(const file of files){const from=path.resolve(file),text=fs.readFileSync(file,'utf8');let m;while((m=rx.exec(text))){const base=path.resolve(path.dirname(file),m[1]);const candidates=[`${base}.js`,path.join(base,'index.js'),base];const dest=candidates.find(p=>set.has(path.resolve(p)));if(dest)graph.get(from).push(path.resolve(dest));}}
let next=0;const indexes=new Map(),low=new Map(),stack=[],on=new Set(),cycles=[];
function visit(v){indexes.set(v,next);low.set(v,next++);stack.push(v);on.add(v);for(const w of graph.get(v)||[]){if(!indexes.has(w)){visit(w);low.set(v,Math.min(low.get(v),low.get(w)));}else if(on.has(w))low.set(v,Math.min(low.get(v),indexes.get(w)));}if(low.get(v)===indexes.get(v)){const comp=[];let w;do{w=stack.pop();on.delete(w);comp.push(w);}while(w!==v);if(comp.length>1)cycles.push(comp);}}
for(const v of graph.keys())if(!indexes.has(v))visit(v);
if(cycles.length){console.error(`Dependency cycle gate FAILED: ${cycles.length} strongly connected component(s)`);for(const c of cycles.sort((a,b)=>b.length-a.length))console.error(' - '+c.map(p=>path.relative(path.join(__dirname,'..'),p)).join(' -> '));process.exit(1);}console.log(`Dependency cycle gate passed: ${files.length} source files, 0 circular SCCs.`);
