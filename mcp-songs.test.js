const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawn}=require('node:child_process');
test('MCP adds songs through the same validation and duplicate guard as the web',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'concert-mcp-'));
  for(const name of ['server.js','music-search.js','music-labels.js'])fs.copyFileSync(path.join(__dirname,name),path.join(dir,name));
  fs.mkdirSync(path.join(dir,'public'));fs.copyFileSync(path.join(__dirname,'public/discovery.js'),path.join(dir,'public/discovery.js'));
  fs.symlinkSync(path.join(__dirname,'node_modules'),path.join(dir,'node_modules'),'dir');
  fs.writeFileSync(path.join(dir,'members.json'),JSON.stringify({members:[{name:'Tester'}]}));
  const child=spawn(process.execPath,['server.js'],{cwd:dir,env:{...process.env,PORT:'13931',ACCESS_CODE:'test-only'},stdio:['ignore','pipe','pipe']});
  try{
    await new Promise((resolve,reject)=>{child.stdout.once('data',resolve);child.once('error',reject);child.once('exit',code=>reject(Error('server exit '+code)));});
    const call=async(method,params,auth=true)=>{const r=await fetch('http://localhost:13931/mcp',{method:'POST',headers:{'content-type':'application/json',...(auth?{'x-access-code':'test-only'}:{})},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})});return {status:r.status,...await r.json()};};
    assert.equal((await call('tools/list',{},false)).status,401);
    const listed=await call('tools/list');assert.ok(listed.result.tools.some(t=>t.name==='add_song'));
    const args={title:' Example ',artist:' Artist ',link:'https://youtu.be/abc123',name:'tester',slots:{guitar:2}};
    const add=await call('tools/call',{name:'add_song',arguments:args});assert.notEqual(add.result.isError,true);
    const saved=JSON.parse(add.result.content[0].text).song;
    assert.equal(saved.title,'Example');assert.equal(saved.createdBy,'Tester');assert.equal(saved.sessions.guitar.capacity,2);
    assert.deepEqual(saved.sessions.guitar.applicants,[]);
    const repeat=await call('tools/call',{name:'add_song',arguments:{...args,link:'https://www.youtube.com/watch?v=abc123&list=track'}});
    assert.equal(repeat.result.isError,true);
    for(const change of [{name:'unknown'},{title:''},{title:42},{link:'javascript:alert(1)'}]){
      const bad=await call('tools/call',{name:'add_song',arguments:{...args,link:'https://youtu.be/other',...change}});assert.equal(bad.result.isError,true);
    }
    const web=await fetch('http://localhost:13931/api/songs',{method:'POST',headers:{'content-type':'application/json','x-access-code':'test-only'},body:JSON.stringify({...args,nickname:'Tester'})});assert.equal(web.status,409);
    const all=await call('tools/call',{name:'list_songs'});assert.equal(JSON.parse(all.result.content[0].text).songs.length,1);
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir,'data.json'))).songs.length,1);
  }finally{child.kill();await new Promise(r=>child.exitCode!==null?r():child.once('exit',r));fs.rmSync(dir,{recursive:true,force:true});}
});
