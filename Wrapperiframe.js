(function(){
  function defineCallGenerate(){
    function CallGenerateImpl(options){
      return new Promise(function(resolve,reject){
        try{
          function post(m){try{parent.postMessage(m,'*')}catch(e){}}
          if(!options||typeof options!=='object'){reject(new Error('Invalid options'));return}
          var id=Date.now().toString(36)+Math.random().toString(36).slice(2);
          function onMessage(e){
            var d=e&&e.data||{};
            if(d.source!=='xiaobaix-host'||d.id!==id)return;
            if(d.type==='generateStreamStart'&&options.streaming&&options.streaming.onStart){try{options.streaming.onStart(d.sessionId)}catch(_){}} 
            else if(d.type==='generateStreamChunk'&&options.streaming&&options.streaming.onChunk){try{options.streaming.onChunk(d.chunk,d.accumulated)}catch(_){}} 
            else if(d.type==='generateStreamComplete'){try{window.removeEventListener('message',onMessage)}catch(_){}
              resolve(d.result)}
            else if(d.type==='generateStreamError'){try{window.removeEventListener('message',onMessage)}catch(_){}
              reject(new Error(d.error||'Stream failed'))}
            else if(d.type==='generateResult'){try{window.removeEventListener('message',onMessage)}catch(_){}
              resolve(d.result)}
            else if(d.type==='generateError'){try{window.removeEventListener('message',onMessage)}catch(_){}
              reject(new Error(d.error||'Generation failed'))}
          }
          try{window.addEventListener('message',onMessage)}catch(_){}
          post({type:'generateRequest',id:id,options:options});
          setTimeout(function(){try{window.removeEventListener('message',onMessage)}catch(e){};reject(new Error('Generation timeout'))},300000);
        }catch(e){reject(e)}
      })
    }
    try{window.CallGenerate=CallGenerateImpl}catch(e){}
    try{window.callGenerate=CallGenerateImpl}catch(e){}
    try{window.__xb_callGenerate_loaded=true}catch(e){}
  }
  try{defineCallGenerate()}catch(e){}
})();