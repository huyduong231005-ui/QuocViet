/** Every picture in the app is drawn here as SVG: nothing to download, nothing
 * to license, and the colours are the ones in styles.css. Goods are kraft,
 * paper is white, the accent is jade and the seal is red. */
const stroke={fill:'none',stroke:'currentColor',strokeWidth:1.8,strokeLinecap:'round',strokeLinejoin:'round'} as const;
const glyphs:Record<string,string>={
 paper:'M6 4h9l3 3v13H6V4zM15 4v3h3M9 11h6M9 14h6M9 17h4',
 toner:'M5 9h14a2 2 0 012 2v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4a2 2 0 012-2zM7 9V6h10v3M7 13h4',
 pen:'M4 20l1-4L16 5l3 3L8 19l-4 1zM14 7l3 3',
 folder:'M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z',
 tape:'M10 5a7 7 0 100 14 7 7 0 000-14zM10 9.5a2.5 2.5 0 100 5 2.5 2.5 0 000-5zM10 19h11v-4h-5',
 clip:'M8 12.5l6.2-6.2a3 3 0 014.3 4.3l-8.3 8.2a5 5 0 01-7-7L11 4',
 note:'M4 4h16v10l-6 6H4V4zM14 20v-6h6',
 box:'M21 8l-9-5-9 5v8l9 5 9-5V8zM3 8l9 5 9-5M12 13v8',
};
/** The kind of goods is read from the product name; anything unrecognised is a box. */
export function goodsKind(name:string):string {
 const n=name.toLocaleLowerCase('vi');
 // "Kẹp giấy" and "Giấy note" both contain "giấy", so the more specific words are tried first.
 return n.includes('note')?'note':n.includes('kẹp')?'clip':n.includes('băng')?'tape':n.includes('bìa')||n.includes('hồ sơ')?'folder':n.includes('mực')?'toner':n.includes('bút')?'pen':n.includes('giấy')?'paper':'box';
}
export function GoodsGlyph({name}:{name:string}){return <svg viewBox="0 0 24 24" {...stroke}><path d={glyphs[goodsKind(name)]}/></svg>;}

const carton=(x:number,y:number,w:number,h:number,body:string,band:string,tape:string)=><g key={`${x}-${y}`}><rect x={x} y={y} width={w} height={h} rx="4" fill={body}/><rect x={x} y={y} width={w} height={Math.round(h/5)} rx="4" fill={band}/><rect x={x+w/2-w/14} y={y} width={w/7} height={h} fill={tape}/></g>;
const sealStar='0,-7 1.8,-2.4 6.7,-2.2 2.9,0.9 4.1,5.7 0,3 -4.1,5.7 -2.9,0.9 -6.7,-2.2 -1.8,-2.4';
function SealMark({x,y,r,color}:{x:number;y:number;r:number;color:string}){return <g transform={`translate(${x} ${y})`}><circle r={r} fill="none" stroke={color} strokeWidth={r/6}/><circle r={r*0.74} fill="none" stroke={color} strokeWidth={r/14}/><polygon points={sealStar} fill={color} transform={`scale(${r/17})`}/></g>;}
function Scale({x,ink,pan,light}:{x:number;ink:string;pan:string;light:string}){return <g transform={`translate(${x} 0)`}>
 <rect x="-38" y="244" width="76" height="8" rx="4" fill={light}/><rect x="-4" y="118" width="8" height="128" rx="4" fill={ink}/>
 <path d="M-65 131L65 109" fill="none" stroke={ink} strokeWidth="7" strokeLinecap="round"/>
 <path d="M-65 131L-81 178M-65 131L-49 178M65 109L49 156M65 109L81 156" fill="none" stroke={light} strokeWidth="2" strokeLinecap="round"/>
 <rect x="-78" y="158" width="26" height="20" rx="3" fill="#C79A5B"/><path d="M-89 178h48a24 14 0 01-48 0z" fill={pan}/>
 <rect x="57" y="142" width="16" height="14" rx="3" fill="#D8B27A"/><path d="M41 156h48a24 14 0 01-48 0z" fill={light}/>
 <circle cx="0" cy="120" r="8" fill={pan}/></g>;}

/** Dashboard head: cartons, a checklist and the approval seal. */
export function DeskArt(){return <svg viewBox="0 0 340 200" role="img" aria-label="Thùng hàng, bảng kê và con dấu duyệt">
 {carton(40,92,130,90,'#C79A5B','#B4884C','#E9D6B2')}{carton(62,40,86,52,'#D8B27A','#C79A5B','#F0E2C8')}{carton(182,118,74,64,'#B4884C','#9A6F38','#D8B27A')}
 <rect x="52" y="140" width="34" height="24" rx="2" fill="#fff"/><rect x="57" y="146" width="24" height="3" rx="1.5" fill="#9A6F38"/><rect x="57" y="153" width="16" height="3" rx="1.5" fill="#9A6F38"/>
 <g transform="rotate(8 268 96)"><rect x="222" y="34" width="92" height="124" rx="6" fill="#fff"/><rect x="250" y="26" width="36" height="16" rx="4" fill="#5CC7B2"/>
  {[58,82].map(y=><g key={y}><rect x="234" y={y} width="12" height="12" rx="3" fill="#0B7A69"/><path d={`M237 ${y+6}l2.5 2.5 4-5`} fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/><rect x="254" y={y+3} width={y===58?46:38} height="5" rx="2.5" fill="#C6D1CE"/></g>)}
  <rect x="235" y="107" width="10" height="10" rx="2.5" fill="none" stroke="#C6D1CE" strokeWidth="2"/><rect x="254" y="109" width="30" height="5" rx="2.5" fill="#C6D1CE"/></g>
 <g transform="rotate(-14 292 150)"><SealMark x={292} y={150} r={28} color="#EF6B62"/></g>
 <rect x="10" y="182" width="320" height="6" rx="3" fill="#2A4E59"/>
</svg>;}

/** Sign-in: goods, the comparison and the sealed paper, in the order the work happens. */
export function LoginArt(){return <svg viewBox="0 0 460 264" role="img" aria-label="Thùng hàng, cán cân so sánh và tờ trình đã đóng dấu">
 {carton(36,150,130,102,'#C79A5B','#B4884C','#E9D6B2')}{carton(58,92,88,58,'#D8B27A','#C79A5B','#F0E2C8')}{carton(172,196,62,56,'#B4884C','#9A6F38','#D8B27A')}
 <rect x="48" y="206" width="38" height="28" rx="2" fill="#fff"/><rect x="54" y="213" width="26" height="3" rx="1.5" fill="#9A6F38"/><rect x="54" y="221" width="18" height="3" rx="1.5" fill="#9A6F38"/>
 <Scale x={288} ink="#C4D6DA" pan="#5CC7B2" light="#9DB4BA"/>
 <g transform="rotate(6 418 204)"><rect x="388" y="160" width="60" height="88" rx="5" fill="#fff"/>{[[172,36],[182,44],[192,28]].map(([y,w])=><rect key={y} x="396" y={y} width={w} height="4" rx="2" fill="#C6D1CE"/>)}<SealMark x={428} y={228} r={17} color="#D8433B"/></g>
 <rect x="20" y="252" width="420" height="6" rx="3" fill="#2A4E59"/>
</svg>;}

/** AHP result: the scale tips towards the leading supplier. */
export function ScaleArt(){return <svg className="winner-art" viewBox="170 96 236 164" role="img" aria-label="Cán cân nghiêng về nhà cung cấp dẫn đầu"><Scale x={288} ink="#0E2A33" pan="#0B7A69" light="#9FB0B5"/></svg>;}

/** Stock: a shelf of cartons; `missing` shows one slot empty. */
export function ShelfArt({missing}:{missing:boolean}){return <svg viewBox="0 0 260 120" role="img" aria-label={missing?'Kệ hàng có một ô đang thiếu':'Kệ hàng đầy đủ'}>
 {carton(20,18,40,36,'#C79A5B','#B4884C','#E9D6B2')}<rect x="66" y="26" width="34" height="28" rx="3" fill="#D8B27A"/>{carton(106,10,44,44,'#B4884C','#9A6F38','#E9D6B2')}<rect x="158" y="24" width="36" height="30" rx="3" fill="#C79A5B"/><rect x="200" y="14" width="40" height="40" rx="3" fill="#D8B27A"/>
 <rect x="8" y="54" width="244" height="6" rx="3" fill="#33474E"/>
 {carton(20,70,46,40,'#B4884C','#9A6F38','#E9D6B2')}<rect x="72" y="80" width="34" height="30" rx="3" fill="#C79A5B"/>
 {missing?<rect x="115" y="75" width="40" height="34" rx="3" fill="#FBEBCB" stroke="#C97F0E" strokeWidth="2" strokeDasharray="5 4"/>:<rect x="114" y="74" width="42" height="36" rx="3" fill="#D8B27A"/>}
 <rect x="162" y="76" width="38" height="34" rx="3" fill="#D8B27A"/><rect x="206" y="66" width="36" height="44" rx="3" fill="#C79A5B"/>
 <rect x="8" y="110" width="244" height="6" rx="3" fill="#33474E"/>
</svg>;}

/** Empty states: a cleared tray, envelopes waiting for quotations, an open carton. */
export function EmptyArt({kind}:{kind:'tray'|'mail'|'box'}){return <svg viewBox="0 0 160 110" aria-hidden="true">{kind==='tray'?<>
 <path d="M24 58l16-30h80l16 30v28a6 6 0 01-6 6H30a6 6 0 01-6-6V58z" fill="#DCE6E4"/><path d="M24 58h34a6 6 0 016 6 16 16 0 0032 0 6 6 0 016-6h34v28a6 6 0 01-6 6H30a6 6 0 01-6-6V58z" fill="#9FB0B5"/>
 <circle cx="80" cy="24" r="14" fill="#0B7A69"/><path d="M73.5 24.5l4.5 4.5 9-10" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/></>:kind==='mail'?<>
 <g transform="rotate(-8 70 54)"><rect x="26" y="22" width="88" height="58" rx="6" fill="#DCE6E4"/></g>
 <rect x="40" y="38" width="92" height="60" rx="6" fill="#fff" stroke="#5B7078" strokeWidth="2"/><path d="M41 44l45 28 45-28" fill="none" stroke="#5B7078" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
 <rect x="104" y="14" width="34" height="22" rx="4" fill="#C79A5B"/><circle cx="112" cy="25" r="3" fill="#fff"/></>:<>
 <path d="M44 50L28 32h34l16 18z" fill="#D8B27A"/><path d="M116 50l16-18H98L82 50z" fill="#B4884C"/><rect x="44" y="50" width="72" height="46" rx="4" fill="#C79A5B"/><rect x="74" y="50" width="12" height="46" fill="#E9D6B2"/><rect x="20" y="96" width="120" height="5" rx="2.5" fill="#C6D1CE"/></>}
</svg>;}
