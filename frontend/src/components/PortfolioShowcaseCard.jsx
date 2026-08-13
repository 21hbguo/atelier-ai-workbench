import { useEffect, useState } from 'react'
import { Heart, Sparkles, Wand2 } from 'lucide-react'
import { promptAPI } from '../api'
function normalizeText(v=''){return String(v||'').replace(/\s+/g,' ').trim()}
function getCardTag(item){
  if(item.categoryLabel||item.category)return item.categoryLabel||item.category;
  return item.imagePath?'图生图':'文生图'
}
function ArtworkPreview({item}){
  if(item.thumbUrl)return (
    <div className="relative aspect-[4/5] overflow-hidden rounded-[1.35rem] border border-white/15 shadow-[0_22px_60px_rgba(21,28,24,0.18)]">
      <img src={item.thumbUrl} alt="" className="h-full w-full object-cover" draggable={false} />
      <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.08),rgba(4,8,7,0.42))]" />
      <div className="absolute inset-x-[16%] top-[14%] h-[20%] rounded-full bg-white/10 blur-2xl" />
    </div>
  );
  return (
    <div className="relative aspect-[4/5] overflow-hidden rounded-[1.35rem] border border-white/15 shadow-[0_22px_60px_rgba(21,28,24,0.18)]" style={{background:'linear-gradient(160deg,#09131f 0%,#0f3950 38%,#c9864f 100%)'}}>
      <div className="absolute inset-0 opacity-95 mix-blend-screen" style={{background:'radial-gradient(circle at 68% 22%,rgba(255,205,122,.92),rgba(255,205,122,0) 36%),radial-gradient(circle at 22% 78%,rgba(94,229,255,.52),rgba(94,229,255,0) 34%)'}} />
      <div className="absolute inset-x-[16%] top-[14%] h-[20%] rounded-full bg-white/10 blur-2xl" />
      <div className="absolute left-[10%] right-[14%] top-[18%] h-[46%] rounded-[42%_58%_56%_44%/38%_40%_60%_62%] border border-white/28 bg-black/10 backdrop-blur-[1px]" />
      <div className="absolute left-[18%] right-[22%] top-[27%] h-[28%] rounded-[48%_52%_43%_57%/40%_37%_63%_60%] bg-white/14" />
      <div className="absolute left-[12%] right-[12%] bottom-[11%] h-[23%] rounded-[1.1rem] border border-white/12 bg-[linear-gradient(180deg,rgba(255,255,255,0.16),rgba(255,255,255,0.03))] backdrop-blur-sm" />
      <div className="absolute left-[16%] bottom-[25%] h-[2px] w-[44%] bg-white/35" />
      <div className="absolute left-[16%] bottom-[18%] h-[2px] w-[28%] bg-white/22" />
      <div className="absolute inset-x-0 bottom-0 h-[36%] bg-[linear-gradient(180deg,rgba(4,8,7,0),rgba(4,8,7,0.46))]" />
    </div>
  )
}
export default function PortfolioShowcaseCard({onUsePrompt}){
  const [items,setItems]=useState([]);
  const [likingId,setLikingId]=useState('');
  useEffect(()=>{
    let dead=false;
    if(typeof promptAPI.listPublic!=='function')return;
    promptAPI.listPublic('', 'likes', undefined, 1, 3).then(({data})=>{
      if(dead)return;
      const rows=(data?.prompts||[]).slice(0,3).map((item,idx)=>{
        const hasImage=!!item.image_path;
        const isEvo=hasImage&&String(item.image_path).includes('/');
        const imageUrl=hasImage?(isEvo?`/api/prompts/evo-thumb/${item.image_path}?size=800`:`/api/prompts/image/${item.image_path}`):null;
        return{
          id:String(item.id||idx),
          tag:getCardTag({category:item.category,categoryLabel:item.category_label,imagePath:item.image_path}),
          title:normalizeText(item.prompt||item.name||'未命名作品'),
          subtitle:(item.author||'system').slice(0,24),
          prompt:item.prompt||'',
          thumbUrl:imageUrl,
          likesCount:item.likes_count||0,
          isLiked:!!item.is_liked,
          canLike:true
        }
      });
      setItems(rows)
    }).catch(()=>setItems([]));
    return()=>{dead=true}
  },[]);
  const handleLike=async(e,item)=>{
    e.stopPropagation();
    if(!item?.canLike||!item?.id||typeof promptAPI.like!=='function'||likingId)return;
    setLikingId(item.id);
    try{
      const {data}=await promptAPI.like(item.id);
      const liked=!!data?.liked;
      setItems(prev=>prev.map(v=>v.id===item.id?{...v,isLiked:liked,likesCount:Math.max(0,Number(v.likesCount||0)+(liked?1:-1))}:v))
    }catch{}
    setLikingId('');
  }
  const top=items[0];
  return (
    <section
      className="w-full max-w-5xl overflow-hidden rounded-[2rem] border shadow-[0_26px_80px_rgba(29,45,37,0.12)]"
      style={{
        background: 'linear-gradient(180deg,color-mix(in srgb,var(--bg-card) 92%,#fff 8%),color-mix(in srgb,var(--bg-primary) 88%,var(--bg-card)))',
        borderColor: 'color-mix(in srgb,var(--accent) 18%,var(--border-color))',
      }}
    >
      <div className="relative overflow-hidden px-5 py-6 sm:px-7 sm:py-7">
        <div
          className="absolute inset-0 opacity-90"
          style={{
            background: [
              'radial-gradient(circle at 12% 18%,color-mix(in srgb,var(--accent) 16%,transparent),transparent 28%)',
              'radial-gradient(circle at 88% 0%,rgba(222,194,145,.24),transparent 26%)',
              'linear-gradient(135deg,rgba(255,255,255,.42),rgba(255,255,255,0))',
            ].join(','),
          }}
        />
        <div className="relative flex flex-col gap-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="max-w-2xl">
              <div className="inline-flex items-center gap-2 rounded-full px-3 py-1 text-[11px] font-semibold tracking-[0.24em] uppercase" style={{background:'color-mix(in srgb,var(--accent) 12%,transparent)',color:'var(--accent)'}}>
                <Sparkles size={12} />作品集
              </div>
              <h2 className="mt-3 text-[2rem] leading-none sm:text-[2.6rem] font-extrabold tracking-tight" style={{backgroundImage:'linear-gradient(135deg,var(--text-primary) 30%,color-mix(in srgb,var(--accent) 65%,var(--text-primary)))',WebkitBackgroundClip:'text',backgroundClip:'text',color:'transparent'}}>
                没有作品时，先从提示词库里最受欢迎的作品开始
              </h2>
              <p className="mt-3 max-w-xl text-sm sm:text-[15px]" style={{color:'var(--text-secondary)'}}>
                点任意卡片就会把提示词放进输入框，你可以直接生成或继续补充参考图。
              </p>
            </div>
            <button
              onClick={()=>top?.prompt&&onUsePrompt?.(top.prompt)}
              disabled={!top?.prompt}
              className="inline-flex items-center gap-2 self-start rounded-full px-4 py-2 text-sm font-semibold transition-transform duration-200 hover:-translate-y-0.5 disabled:opacity-40"
              style={{background:'var(--accent)',color:'#fff',boxShadow:'0 16px 40px color-mix(in srgb,var(--accent) 28%,transparent)'}}
            >
              <Wand2 size={15} />直接试第一张
            </button>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            {(items.length?items:[{id:'starter-1',tag:'入门',title:'写一句画面描述',subtitle:'快速开始',prompt:'一只戴着小红帽的猫坐在月光下的窗台上，温暖灯光，细腻插画风格',likesCount:0},{id:'starter-2',tag:'进阶',title:'补充风格和氛围',subtitle:'快速开始',prompt:'雨后的未来城市街角，霓虹倒影，电影感构图，赛博朋克氛围，高细节',likesCount:0},{id:'starter-3',tag:'参考图',title:'上传图片做同款',subtitle:'快速开始',prompt:'基于参考图生成同款构图，保留主体姿态，改为清新日系水彩风格',likesCount:0}]).map(item=>(
              <div
                key={item.id}
                onClick={()=>item.prompt&&onUsePrompt?.(item.prompt)}
                role="button"
                tabIndex={0}
                onKeyDown={e=>{if((e.key==='Enter'||e.key===' ')&&item.prompt){e.preventDefault();onUsePrompt?.(item.prompt)}}}
                className="group relative overflow-hidden rounded-[1.6rem] border p-3 text-left transition-all duration-300 hover:-translate-y-1"
                style={{background:'color-mix(in srgb,var(--bg-card) 82%,#fff 18%)',borderColor:'color-mix(in srgb,var(--accent) 14%,var(--border-color))',boxShadow:'0 12px 36px rgba(26,39,32,0.08)'}}
              >
                <ArtworkPreview item={item} />
                <div className="mt-3 flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="text-[11px] font-semibold tracking-[0.18em] uppercase" style={{color:'var(--accent)'}}>{item.tag}</div>
                    <div className="mt-1 min-w-0 truncate text-lg leading-none" style={{color:'var(--text-primary)',fontFamily:'"Cormorant Garamond","STSong","Noto Serif SC",serif',fontWeight:600}}>{item.title}</div>
                    <div className="mt-1 truncate text-xs" style={{color:'var(--text-secondary)'}}>{item.subtitle}</div>
                  </div>
                </div>
                <p className="mt-3 line-clamp-3 text-xs leading-5" style={{color:'var(--text-secondary)'}}>{item.prompt}</p>
                <div className="mt-3 flex items-center gap-2">
                  {item.canLike ? (
                    <button
                      type="button"
                      onClick={e=>handleLike(e,item)}
                      disabled={likingId===item.id}
                      className="inline-flex items-center gap-1 rounded-full px-3 py-1 text-[11px] font-medium transition-colors disabled:opacity-60"
                      style={{background:item.isLiked?'color-mix(in srgb,#ef4444 14%,transparent)':'color-mix(in srgb,var(--accent) 10%,transparent)',color:item.isLiked?'#ef4444':'var(--text-primary)'}}
                    >
                      <Heart size={12} className={item.isLiked?'fill-red-500 text-red-500':''} />点赞 {item.likesCount}
                    </button>
                  ) : (
                    <div className="inline-flex rounded-full px-3 py-1 text-[11px] font-medium" style={{background:'color-mix(in srgb,var(--accent) 10%,transparent)',color:'var(--text-primary)'}}>示例</div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}
