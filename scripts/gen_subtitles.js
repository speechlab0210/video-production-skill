/* Generate aligned SRT: Whisper word timestamps for timing, ORIGINAL narration text
   for display (ASR output mishears — never use it as subtitle text).
   Offsets come from ACTUAL clip durations (ffprobe on temp/clip_XX.mp4), which avoids
   the -shortest drift bug (assuming audioDur+padding drifts +1s per slide).

   Usage: node gen_subtitles.js [project_dir]
   Needs: OPENAI_API_KEY (env var or .env in project dir), temp/clip_XX.mp4 from
   assemble.js, audio/slide_XX.mp3, narration.json.
   Whisper word timings are cached in temp/words_NN.json (re-runs are free). */
const fs=require('fs'),path=require('path'),https=require('https'),{execSync}=require('child_process');
const DIR=path.resolve(process.argv[2]||process.cwd());
try{const envp=path.join(DIR,'.env');for(const line of fs.readFileSync(envp,'utf8').split(/\r?\n/)){const m=line.match(/^([A-Z_]+)=(.*)$/);if(m&&!process.env[m[1]])process.env[m[1]]=m[2].trim().replace(/^["']|["']$/g,'');}}catch(e){}
const cfgP=path.join(DIR,'config.json');
const cfg=fs.existsSync(cfgP)?JSON.parse(fs.readFileSync(cfgP,'utf8')):{};
const FFPROBE=cfg.ffprobe||'ffprobe';
const LANG=cfg.asr?.language||'zh';
const OK=process.env.OPENAI_API_KEY;
if(!OK){console.error('ERROR: OPENAI_API_KEY not set');process.exit(1);}
const narration=JSON.parse(fs.readFileSync(path.join(DIR,'narration.json'),'utf8'));
const N=narration.length;

function clipDur(i){const p=path.join(DIR,'temp',`clip_${String(i+1).padStart(2,'0')}.mp4`);return parseFloat(execSync(`"${FFPROBE}" -v error -show_entries format=duration -of csv=p=0 "${p}"`,{encoding:'utf8'}).trim());}

function whisperWords(mp3){const a=fs.readFileSync(mp3);const b='----b'+Date.now()+Math.random();const parts=[`--${b}\r\nContent-Disposition: form-data; name="file"; filename="a.mp3"\r\nContent-Type: audio/mpeg\r\n\r\n`,a,`\r\n--${b}\r\nContent-Disposition: form-data; name="model"\r\n\r\nwhisper-1`,`\r\n--${b}\r\nContent-Disposition: form-data; name="language"\r\n\r\n${LANG}`,`\r\n--${b}\r\nContent-Disposition: form-data; name="response_format"\r\n\r\nverbose_json`,`\r\n--${b}\r\nContent-Disposition: form-data; name="timestamp_granularities[]"\r\n\r\nword`,`\r\n--${b}--\r\n`];const body=Buffer.concat(parts.map(p=>typeof p==='string'?Buffer.from(p):p));return new Promise((res,rej)=>{const r=https.request({hostname:'api.openai.com',path:'/v1/audio/transcriptions',method:'POST',headers:{'Authorization':`Bearer ${OK}`,'Content-Type':`multipart/form-data; boundary=${b}`,'Content-Length':body.length}},rs=>{let d='';rs.on('data',x=>d+=x);rs.on('end',()=>{if(rs.statusCode!==200)return rej(new Error(d.slice(0,200)));try{const j=JSON.parse(d);res({words:j.words||[],dur:j.duration});}catch(e){rej(e)}})});r.setTimeout(90000,()=>r.destroy(new Error('whisper timeout')));r.on('error',rej);r.write(body);r.end();});}

// split into tokens, marking strong (sentence-ending) boundaries; strip punctuation for display
function splitTokens(text){
  const toks=[]; let cur='';
  for(const ch of text){
    if('。！？'.includes(ch)){ if(cur.trim())toks.push({t:cur.trim(),strong:true}); cur=''; }
    else if('，；、：—–…\n'.includes(ch)){ if(cur.trim())toks.push({t:cur.trim(),strong:false}); cur=''; }
    else if('「」『』（）()《》'.includes(ch)){ /* drop quotes/brackets */ }
    else cur+=ch;
  }
  if(cur.trim())toks.push({t:cur.trim(),strong:false});
  return toks.filter(x=>x.t);
}
// display width: CJK = 1, Latin/space = 0.5 (max 16 full-width per line to avoid wrapping)
function dw(s){let w=0;for(const c of s)w+= c.charCodeAt(0)<=0xff?0.5:1; return w;}
function capSplit(s,maxw){ // split s into pieces of width<=maxw, never inside a Latin run
  const parts=[]; let cur='', curw=0;
  for(let i=0;i<s.length;i++){
    let seg=s[i];
    if(/[A-Za-z0-9]/.test(seg)){ while(i+1<s.length && /[A-Za-z0-9]/.test(s[i+1])) seg+=s[++i]; }
    const w=dw(seg);
    if(curw+w>maxw && cur){ parts.push(cur); cur=''; curw=0; }
    cur+=seg; curw+=w;
  }
  if(cur)parts.push(cur);
  return parts;
}
function chunks(text){
  const toks=splitTokens(text);
  const out=[];
  for(const tk of toks){
    const prev=out[out.length-1];
    if(prev && !prev.strong && (tk.t.length<6 || prev.t.length<8) && (dw(prev.t)+dw(tk.t))<=16){
      prev.t+=tk.t; prev.strong=tk.strong;
    } else out.push({t:tk.t,strong:tk.strong});
  }
  const capped=[];
  for(const o of out){ for(const p of capSplit(o.t,16)) capped.push(p); }
  return capped;
}

function fmt(t){let ms=Math.round((t-Math.floor(t))*1000);let sec=Math.floor(t);if(ms>=1000){ms-=1000;sec+=1;}const h=Math.floor(sec/3600),m=Math.floor(sec%3600/60),s=sec%60;return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')},${String(ms).padStart(3,'0')}`;}

(async()=>{
  let offset=0, srt='', idx=1;
  for(let i=0;i<N;i++){
    const cd=clipDur(i);
    const mp3=path.join(DIR,'audio',`slide_${String(i+1).padStart(2,'0')}.mp3`);
    const cacheP=path.join(DIR,'temp',`words_${String(i+1).padStart(2,'0')}.json`);
    let words=[];
    if(fs.existsSync(cacheP)){ words=JSON.parse(fs.readFileSync(cacheP,'utf8')); }
    else { try{const w=await whisperWords(mp3);words=w.words||[];fs.writeFileSync(cacheP,JSON.stringify(words));}catch(e){console.log(`slide ${i+1} whisper err: ${e.message} — falling back to proportional timing`);} }
    const speechStart = words.length? Math.max(0, words[0].start-0.05):0;
    const speechEnd = words.length? Math.min(cd, words[words.length-1].end):cd;
    const span = Math.max(0.5, speechEnd-speechStart);
    const nw = words.length;
    const ch = chunks(narration[i]);
    const totalChars = ch.reduce((a,c)=>a+c.length,0)||1;
    let cum=0;
    const timeAtFrac=(f)=>{ if(!nw) return speechStart+f*span; const wi=Math.min(nw-1, Math.max(0, Math.round(f*nw))); return (wi<nw)? words[wi].start : speechEnd; };
    for(let k=0;k<ch.length;k++){
      const c=ch[k];
      const fa=cum/totalChars, fb=(cum+c.length)/totalChars; cum+=c.length;
      let st=offset+ (nw? timeAtFrac(fa) : speechStart+fa*span);
      let en=offset+ (nw? (k===ch.length-1? speechEnd : timeAtFrac(fb)) : speechStart+fb*span);
      if(en-st<0.6) en=st+0.6;
      srt+=`${idx++}\n${fmt(st)} --> ${fmt(en)}\n${c}\n\n`;
    }
    offset+=cd;
    console.log(`slide ${String(i+1).padStart(2,'0')}: clip=${cd.toFixed(2)}s words=${nw} chunks=${ch.length}`);
  }
  fs.writeFileSync(path.join(DIR,'subtitles_aligned.srt'), '﻿'+srt, 'utf8');
  console.log(`\nSRT written. total video offset=${offset.toFixed(2)}s`);
})();
