import {execFileSync} from 'node:child_process';
import {writeFileSync,cpSync} from 'node:fs';
let sha='uncommitted';try{sha=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim();}catch{}
writeFileSync('dist/build.json',JSON.stringify({app:'paperwork',sha,contract:1,dataVersion:1,processing:'browser-local'})+'\n');
cpSync('node_modules/pdfjs-dist/cmaps','dist/pdf-assets/cmaps',{recursive:true});cpSync('node_modules/pdfjs-dist/standard_fonts','dist/pdf-assets/standard_fonts',{recursive:true});cpSync('node_modules/pdfjs-dist/wasm','dist/pdf-assets/wasm',{recursive:true});
