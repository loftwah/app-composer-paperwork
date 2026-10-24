import {chromium,webkit} from 'playwright';
import {createServer} from 'node:http';
import {readFileSync,existsSync,mkdirSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
const output=path.resolve('output/browser');mkdirSync(output,{recursive:true});
const types={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.ttf':'font/ttf','.wasm':'application/wasm','.svg':'image/svg+xml','.png':'image/png','.pdf':'application/pdf','.bcmap':'application/octet-stream','.json':'application/json'};
const server=createServer((req,res)=>{let name=decodeURIComponent(new URL(req.url,'http://localhost').pathname);if(name==='/')name='/index.html';const file=path.resolve('dist','.'+name);if(!file.startsWith(path.resolve('dist')+path.sep)||!existsSync(file)){res.writeHead(404);res.end();return;}res.setHeader('Content-Type',types[path.extname(file)]||'application/octet-stream');res.setHeader('Content-Security-Policy',readFileSync('public/_headers','utf8').split('\n').find(x=>x.includes('Content-Security-Policy')).split('Content-Security-Policy: ')[1]);res.end(readFileSync(file));});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=process.env.PAPERWORK_ORIGIN||`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({headless:true,channel:'chrome'});
try{
 const page=await browser.newPage({viewport:{width:1440,height:1000},acceptDownloads:true});const errors=[],requests=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>requests.push({url:r.url(),method:r.method(),body:r.postData()}));
 await page.goto(base);await page.getByRole('button',{name:'Try a sample',exact:true}).click();await page.waitForFunction(()=>document.querySelectorAll('[data-field]').length>=8);await page.screenshot({path:output+'/editor-initial.png'});
 console.log(JSON.stringify({fields:await page.locator('[data-field]').evaluateAll(els=>els.map(e=>({name:e.dataset.field,type:e.type,value:e.value,checked:e.checked}))),errors}));
 await page.locator('[data-field="fullName"]').fill('Renée Example');await page.locator('[data-field="notes"]').fill('Planting herbs.\nBringing a fictional hat.');await page.locator('[data-field="updates"]').check();await page.locator('[data-field="session"][value="Afternoon"]').check();await page.locator('[data-field="experience"]').selectOption('Experienced');await page.locator('[data-field="interests"]').selectOption(['Flowers','Vegetables']);await page.locator('[data-field="date"]').click();
 await page.locator('[data-tool="pen"]').click();let box=await page.locator('#page').boundingBox();const scale=box.width/595;const p=(x,y)=>({x:box.x+x*scale,y:box.y+y*scale});
 await page.mouse.move(p(90,690).x,p(90,690).y);await page.mouse.down();await page.mouse.move(p(200,680).x,p(200,680).y,{steps:20});await page.mouse.up();
 await page.locator('[data-tool="text"]').click();await page.mouse.click(p(80,715).x,p(80,715).y);await page.locator('#text-content').fill('Fictional note');await page.getByRole('button',{name:'Done',exact:true}).click();
 await page.locator('[data-tool="tick"]').click();await page.mouse.click(p(44,645).x,p(44,645).y);
 await page.locator('#signature-file').setInputFiles('public/examples/fictional-signature.png');await page.mouse.click(p(315,725).x,p(315,725).y);
 const downloadPromise=page.waitForEvent('download');await page.getByRole('button',{name:'Save PDF',exact:true}).click();const download=await downloadPromise;await download.saveAs(output+'/completed.pdf');
 await page.screenshot({path:output+'/editor-completed.png'});console.log('SAVED '+output+'/completed.pdf');console.log('STATUS '+await page.locator('#status').textContent());
 assert.deepEqual(errors,[]);assert.equal(requests.filter(r=>r.method!=='GET'||!r.url.startsWith(base)).length,0);
 writeFileSync(output+'/requests.json',JSON.stringify(requests,null,2));
}finally{await browser.close();await new Promise(r=>server.close(r));}
