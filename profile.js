// Vercel serverless function: best-effort lookup of public TikTok profile data.
// It does not log in, use cookies, or access private creator analytics.
const https = require('https');

function get(url) {
  return new Promise((resolve, reject) => {
    https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9'
      },
      timeout: 12000
    }, res => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => resolve({status:res.statusCode, body}));
    }).on('error', reject).on('timeout', function(){this.destroy(new Error('TikTok request timed out'));});
  });
}
function decodeHtml(s){return s.replace(/&quot;/g,'"').replace(/&amp;/g,'&').replace(/&#39;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>')}
function findProfile(root, username) {
  const seen = new Set();
  function walk(x, depth) {
    if (!x || typeof x !== 'object' || depth > 18 || seen.has(x)) return null;
    seen.add(x);
    if (x.user && x.stats && (x.user.uniqueId || x.user.nickname)) {
      if (!username || String(x.user.uniqueId||'').toLowerCase() === username.toLowerCase()) return x;
    }
    if (x.userInfo && x.userInfo.user && x.userInfo.stats) {
      const y=x.userInfo;
      if (!username || String(y.user.uniqueId||'').toLowerCase() === username.toLowerCase()) return y;
    }
    for (const v of Object.values(x)) { const found=walk(v,depth+1); if(found)return found; }
    return null;
  }
  return walk(root,0);
}
module.exports = async (req,res) => {
  res.setHeader('Cache-Control','s-maxage=300, stale-while-revalidate=600');
  res.setHeader('Access-Control-Allow-Origin','*');
  const username=String(req.query.username||'').replace(/^@/,'').trim();
  if(!/^[A-Za-z0-9._]{2,24}$/.test(username)) return res.status(400).json({ok:false,message:'Format username tidak valid.'});
  try {
    const r=await get('https://www.tiktok.com/@'+encodeURIComponent(username));
    if(r.status===404) return res.status(404).json({ok:false,message:'Username tidak ditemukan atau profil tidak tersedia.'});
    if(r.status<200||r.status>=300) return res.status(502).json({ok:false,message:'TikTok membatasi permintaan saat ini. Coba lagi nanti.'});
    const html=decodeHtml(r.body);
    const scripts=[...html.matchAll(/<script[^>]+id=["'](?:__UNIVERSAL_DATA_FOR_REHYDRATION__|SIGI_STATE)["'][^>]*>([\s\S]*?)<\/script>/gi)];
    let data=null, profile=null;
    for(const m of scripts){try{data=JSON.parse(m[1]);profile=findProfile(data,username);if(profile)break;}catch(e){}}
    if(!profile){
      // Some page versions expose JSON inside the HTML even when script markup differs.
      const marker=html.indexOf('__UNIVERSAL_DATA_FOR_REHYDRATION__');
      if(marker>=0){const start=html.indexOf('{',marker);if(start>=0){let depth=0,inString=false,escape=false,end=-1;for(let i=start;i<html.length;i++){const c=html[i];if(inString){if(escape)escape=false;else if(c==='\\')escape=true;else if(c==='"')inString=false;}else{if(c==='"')inString=true;else if(c==='{')depth++;else if(c==='}'&&--depth===0){end=i+1;break;}}}if(end>start){try{profile=findProfile(JSON.parse(html.slice(start,end)),username)}catch(e){}}}}
    }
    if(!profile) return res.status(503).json({ok:false,message:'Halaman TikTok tidak memberikan data profil yang bisa dibaca. Ini bisa terjadi karena pembatasan TikTok.'});
    const u=profile.user||{}, s=profile.stats||{};
    const n=v=>{const z=Number(v);return Number.isFinite(z)?z:0};
    return res.status(200).json({ok:true,profile:{
      username:u.uniqueId||username,nickname:u.nickname||'',bio:u.signature||'',
      avatar:u.avatarLarger||u.avatarMedium||u.avatarThumb||'',
      followers:n(s.followerCount),following:n(s.followingCount),likes:n(s.heartCount||s.heart),
      videoCount:n(s.videoCount),privateAccount:!!u.privateAccount
    }});
  } catch(err) {
    return res.status(502).json({ok:false,message:'Gagal menghubungi TikTok. Periksa koneksi dan coba lagi.'});
  }
};
