import test from 'node:test';
import assert from 'node:assert/strict';
import {matchLayoutPages,navigatorItems} from '../electron/document-operations.mjs';
import {validatePng} from '../electron/png-validation.mjs';

test('layout mapping requires distinct number/title matches and does not match number prefixes',()=>{
  const layouts=[{guid:'synthetic-a',number:'A-1',name:'Synthetic Plan'},{guid:'synthetic-b',number:'A-10',name:'Synthetic Plan'}];
  const pages=[{source:'synthetic.pdf',page:1,text:'A-10 Synthetic Plan'}];
  assert.deepEqual(matchLayoutPages(layouts,pages).map(x=>x.status),['missing','matched']);
  assert.ok(matchLayoutPages([layouts[1],{...layouts[1],guid:'synthetic-c'}],pages).every(x=>x.status==='ambiguous'));
  assert.equal(matchLayoutPages([layouts[1]],[...pages,{...pages[0],page:2}])[0].status,'ambiguous');
});

test('navigator inventory preserves nested layout identities and publisher source references',()=>{
  const items=navigatorItems({name:'SYNTHETIC',children:[{navigatorItem:{type:'LayoutItem',name:'Plan',uiId:'A-1',navigatorItemId:{guid:'synthetic-layout'},sourceNavigatorItemId:{guid:'synthetic-source'}}}]});
  assert.equal(items[1].guid,'synthetic-layout');assert.equal(items[1].sourceGuid,'synthetic-source');assert.deepEqual(items[1].path,['SYNTHETIC']);
});

test('capture validator rejects corrupt data even with an intact PNG header',()=>{
  const data=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4////fwAJ+wP9KobjigAAAABJRU5ErkJggg==','base64');
  assert.deepEqual(validatePng(data),{width:1,height:1});data[45]^=1;assert.throws(()=>validatePng(data));
  assert.throws(()=>validatePng(data.subarray(0,33)));
});
