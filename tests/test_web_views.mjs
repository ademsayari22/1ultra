import assert from 'node:assert/strict';
import {test} from 'node:test';
import {priceMinor} from '../web/api.js';
import {inspector} from '../web/game-views.js';
import {historyView} from '../web/record-editor.js';

test('warm contacts show their relationship reference without an empty source link',()=>{
 const data={roles:[],tasks:[],leads:[{id:'warm',company:'Example',kind:'warm_contact',status:'discovered',source_reference:'relationship-note'}],payments:[],runs:[],automations:[]};
 const html=inspector(data,'warm');
 assert.ok(html.includes('relationship-note'));
 assert.ok(!html.includes('href=""'));
});

test('minor-unit conversion preserves TND precision and rejects excess decimals',()=>{
 assert.equal(priceMinor('1.250','TND'),1250);
 assert.equal(priceMinor('1.25','USD'),125);
 assert.equal(priceMinor('','TND'),null);
 assert.throws(()=>priceMinor('1.2501','TND'));
});

test('historical evidence is escaped and can be loaded for a new revision',()=>{
 const record={history:[{at:'2026-10-05T10:00:00Z',before:{status:'done',completion_evidence:'<script>unsafe()</script>'},after:{status:'in_progress'}}]};
 const html=historyView(record,'task');
 assert.ok(html.includes('&lt;script&gt;'));
 assert.ok(!html.includes('<script>'));
 assert.ok(html.includes('data-use-task-revision="0"'));
});
