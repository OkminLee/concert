(function(root){
  const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function links(text){
    return [...String(text).matchAll(/https?:\/\/[^\s<>"']+/gi)].flatMap(m=>{
      let url=m[0].replace(/[.,!?;:]+$/g,'');
      while(url.endsWith(')')&&(url.match(/\)/g)||[]).length>(url.match(/\(/g)||[]).length)url=url.slice(0,-1);
      try{const u=new URL(url);if(!u.hostname||u.username||u.password)return [];return [{url,index:m.index}];}catch{return [];}
    });
  }
  function render(text){
    text=String(text);const found=links(text);let end=0,html='';
    for(const item of found){html+=esc(text.slice(end,item.index))+'<a href="'+esc(item.url)+'" target="_blank" rel="noopener noreferrer">'+esc(item.url)+'</a>';end=item.index+item.url.length;}
    html+=esc(text.slice(end));
    return html+[...new Set(found.map(x=>x.url))].slice(0,3).map(url=>'<a class="comment-preview" data-preview-url="'+esc(url)+'" href="'+esc(url)+'" target="_blank" rel="noopener noreferrer"><span class="preview-copy"><strong>'+esc(new URL(url).hostname)+'</strong><small>'+esc(url)+'</small></span></a>').join('');
  }
  const cache=new Map();
  function hydrate(container,api){
    for(const card of container.querySelectorAll('.comment-preview:not([data-loaded])')){
      card.dataset.loaded='true';const url=card.dataset.previewUrl;
      if(!cache.has(url)){if(cache.size>200)cache.clear();cache.set(url,api('/api/link-preview','POST',{url}).catch(()=>null));}
      cache.get(url).then(meta=>{
        if(!meta?.available||!card.isConnected)return;
        card.querySelector('strong').textContent=meta.title;
        card.querySelector('small').textContent=[meta.author,meta.site].filter(Boolean).join(' · ');
        if(meta.thumbnail){const img=document.createElement('img');img.src=meta.thumbnail;img.alt='';img.loading='lazy';img.referrerPolicy='no-referrer';img.onerror=()=>img.remove();card.prepend(img);}
      });
    }
  }
  const helpers={links,render,hydrate};if(typeof module!=='undefined')module.exports=helpers;else root.CommentLinks=helpers;
})(globalThis);
