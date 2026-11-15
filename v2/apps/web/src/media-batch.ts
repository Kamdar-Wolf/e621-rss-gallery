import type {EntryMedia} from "./api.js";

export type BatchProgress={
  total:number;done:number;saved:number;skipped:number;failed:number;cancelled:boolean;
};
export async function saveImageGallery(
  media:EntryMedia[],
  existing:Iterable<string>,
  save:(item:EntryMedia)=>Promise<unknown>,
  onProgress:(progress:BatchProgress)=>void=()=>{},
  shouldCancel:()=>boolean=()=>false
):Promise<BatchProgress>{
  const images=media.filter(item=>item.kind==="image").slice(0,32);
  const prior=new Set(existing);
  const state:BatchProgress={
    total:images.length,done:0,saved:0,skipped:0,failed:0,cancelled:false
  };
  for(const item of images){
    if(shouldCancel()){
      state.cancelled=true;break;
    }
    if(prior.has(item.url)){
      state.skipped++;state.done++;
      onProgress({...state});
      continue;
    }
    try{
      await save(item);
      prior.add(item.url);
      state.saved++;
    }catch(error){
      state.failed++;
      // A server rate limit or a full local cache is not solved by trying more URLs.
      if(error instanceof Error&&/429|limit|kvót|quota|48 MiB|120 obrázků/i.test(error.message)){
        state.done++;onProgress({...state});
        break;
      }
    }
    state.done++;
    onProgress({...state});
  }
  return state;
}
