import test from "node:test";
import assert from "node:assert/strict";
import {saveImageGallery} from "../apps/web/src/media-batch.js";
import type {EntryMedia} from "../apps/web/src/api.js";

const entry=(id:string,kind:"image"|"video"|"audio"="image"):EntryMedia=>({
  id,url:"https://example.org/"+id+".png",kind,
  mimeType:"image/png",position:Number(id),width:null,height:null
});
test("batch gallery saves images in order, skips stored files and does not save video",async()=>{
  const calls:string[]=[];
  const progress:number[]=[];
  const result=await saveImageGallery(
    [entry("1"),entry("2"),entry("3","video"),entry("4")],
    ["https://example.org/2.png"],
    async image=>{calls.push(image.id);},
    state=>{progress.push(state.done);}
  );
  assert.deepEqual(calls,["1","4"]);
  assert.deepEqual(progress,[1,2,3]);
  assert.deepEqual(result,{total:3,done:3,saved:2,skipped:1,failed:0,cancelled:false});
});
test("batch handles one failed image while continuing with remaining pages",async()=>{
  const result=await saveImageGallery(
    [entry("1"),entry("2"),entry("3")],[],
    async item=>{if(item.id==="2")throw Error("Not found");}
  );
  assert.equal(result.saved,2);
  assert.equal(result.failed,1);
  assert.equal(result.done,3);
});
test("batch respects explicit stop and storage limits",async()=>{
  let cancelled=false;
  const stops:string[]=[];
  const first=await saveImageGallery([entry("1"),entry("2"),entry("3")],[],
    async item=>{stops.push(item.id);cancelled=true;},
    ()=>{},()=>cancelled);
  assert.deepEqual(stops,["1"]);
  assert.equal(first.cancelled,true);
  const remaining=await saveImageGallery([entry("1"),entry("2"),entry("3")],[],
    async item=>{if(item.id==="2")throw Error("Mediální cache překročila 48 MiB");});
  assert.equal(remaining.done,2);
  assert.equal(remaining.failed,1);
});
