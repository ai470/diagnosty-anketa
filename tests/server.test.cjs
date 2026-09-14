const {test, before, after} = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const server = require('../tools/serve.cjs');
let port;
before(async () => {await new Promise(r=>server.listen(0,'127.0.0.1',r)); port=server.address().port;});
after(async () => {await new Promise(r=>server.close(r));});
function request(path, method='GET') {
  return new Promise((resolve,reject)=>{
    const req=http.request({hostname:'127.0.0.1',port,path,method},res=>{
      const chunks=[];res.on('data',c=>chunks.push(c));
      res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body:Buffer.concat(chunks)}));
    });req.on('error',reject);req.end();
  });
}
test('production server serves printable assets and identifies health revision', async () => {
  for(const [path,type] of [['/','text/html'],['/assets/print.css','text/css'],['/assets/strategy.js','text/javascript'],['/assets/fonts/Golos-Text-400.ttf','font/ttf']]) {
    const result=await request(path); assert.equal(result.status,200);
    assert.ok(result.headers['content-type'].startsWith(type)); assert.ok(result.body.length>100);
    assert.equal(result.headers['cache-control'],'no-store');
  }
  const head=await request('/','HEAD'); assert.equal(head.status,200); assert.equal(head.body.length,0);
  assert.equal(JSON.parse((await request('/health')).body).status,'ok');
});
test('repository, server files, traversal and malformed paths cannot be served or crash the process', async () => {
  for(const path of ['/.git/config','/package.json','/apps-script/Code.gs','/tools/serve.cjs','/assets/../README.md','/assets/%2e%2e%2findex.html','/assets/%5c..%5cindex.html']) assert.equal((await request(path)).status,404,path);
  assert.equal((await request('/%ZZ')).status,400);
  assert.equal((await request('/','POST')).status,405);
  assert.equal((await request('/health')).status,200);
});
