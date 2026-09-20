/* Build 174: cooperative work scheduling. No network, state or geometry owner. */
(() => {
  if(window.FPWork174)return;
  let yields=0,maxSliceMs=0;
  const pause=()=>new Promise(resolve=>setTimeout(resolve,0));
  async function each(items,visit,{current=()=>true,batch=100,budgetMs=6}={}){
    let started=performance.now(),count=0;
    for(let i=0;i<items.length;i++){
      if(!current())return false;
      const result=visit(items[i],i);
      if(result&&typeof result.then==='function')await result;
      if(!current())return false;
      if(++count>=batch||performance.now()-started>=budgetMs){
        maxSliceMs=Math.max(maxSliceMs,performance.now()-started);
        if(i+1<items.length){yields++;await pause();}
        count=0;started=performance.now();
      }
    }
    return true;
  }
  window.FPWork174=Object.freeze({each,pause,snapshot:()=>({yields,maxSliceMs,budgetMs:6,batch:100})});
})();
