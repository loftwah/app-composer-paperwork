import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
test('owner-supplied acceptance corpus retains its distributed hashes',()=>{
 const root=new URL('./fixtures/paperwork-fixtures/',import.meta.url);
 for(const [name,sha] of Object.entries(JSON.parse(readFileSync(new URL('SHA256SUMS.json',root),'utf8'))))assert.equal(createHash('sha256').update(readFileSync(new URL(name,root))).digest('hex'),sha,name);
});
