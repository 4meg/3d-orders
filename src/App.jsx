import React, { useEffect, useMemo, useState, useCallback } from "react";
import html2pdf from "html2pdf.js/dist/html2pdf.bundle.min.js";
import { db } from "./firebase";
import { collection, addDoc, getDocs, doc, updateDoc, deleteDoc } from "firebase/firestore";

// ─── Config ────────────────────────────────────────────────────────────────
const TG_TOKEN   = import.meta.env.VITE_TG_TOKEN   || "";
const TG_CHAT_ID = import.meta.env.VITE_TG_CHAT_ID || "";
const DELIVERY_COMPANY = "الوسيط";
const DELIVERY_FEE     = 5000;
const DEFAULT_STATUS   = "تحت التصميم";

const provinces = ["بغداد","البصرة","نينوى","أربيل","النجف","كربلاء","السليمانية","دهوك","كركوك","ديالى","الأنبار","بابل","واسط","صلاح الدين","الديوانية","ذي قار","ميسان","المثنى"];
const defaultColors   = [{name:"أسود",code:"#111827"},{name:"أبيض",code:"#ffffff"},{name:"أحمر",code:"#dc2626"},{name:"أزرق",code:"#2563eb"},{name:"أخضر",code:"#16a34a"}];
const defaultProducts = ["حافظة كيبل","ميدالية","مجسم 3D","ستاند","شعار","قطعة خاصة"];
const statuses        = ["تحت التصميم","تحت الطباعة","جاهز","قيد التوصيل","مكتمل","ملغي"];

const STATUS_STYLE = {
  "تحت التصميم": {bg:"#0c2040",color:"#60a5fa",dot:"#3b82f6"},
  "تحت الطباعة": {bg:"#2a1d00",color:"#fbbf24",dot:"#f59e0b"},
  "جاهز":        {bg:"#0a2015",color:"#34d399",dot:"#10b981"},
  "قيد التوصيل": {bg:"#1e0f35",color:"#c084fc",dot:"#a855f7"},
  "مكتمل":       {bg:"#052020",color:"#2dd4bf",dot:"#14b8a6"},
  "ملغي":        {bg:"#250a0a",color:"#f87171",dot:"#ef4444"},
};

// ─── Theme ──────────────────────────────────────────────────────────────────
const DARK = {
  bg:"#0d1117", surface:"#161b22", surface2:"#21262d",
  border:"#30363d", border2:"#3d4451",
  text:"#e6edf3", textMuted:"#8b949e", textDim:"#484f58",
  accent:"#58a6ff", accentBg:"#0c2d6b",
  green:"#3fb950", greenBg:"#0d2818",
  red:"#f85149",   redBg:"#250a0a",
  yellow:"#d29922", yellowBg:"#2a1d00",
  sidebar:"#0d1117",
};
const LIGHT = {
  bg:"#f3f4f6", surface:"#ffffff", surface2:"#f9fafb",
  border:"#e5e7eb", border2:"#d1d5db",
  text:"#111827", textMuted:"#6b7280", textDim:"#9ca3af",
  accent:"#2563eb", accentBg:"#dbeafe",
  green:"#16a34a", greenBg:"#dcfce7",
  red:"#dc2626",   redBg:"#fee2e2",
  yellow:"#d97706", yellowBg:"#fef3c7",
  sidebar:"#1e293b",
};

// ─── Helpers ────────────────────────────────────────────────────────────────
function loadLS(key, fallback) {
  try { const s=localStorage.getItem(key); if(s){const p=JSON.parse(s);if(Array.isArray(p)&&p.length>0)return p;} } catch{}
  return fallback;
}
function saveLS(key,val){ try{localStorage.setItem(key,JSON.stringify(val));}catch{} }

function normalizePhone(p){ return String(p||"").replace(/\D/g,"").trim(); }
function getIraqWA(phone){
  let d=normalizePhone(phone);
  if(d.startsWith("00964"))d=d.slice(2);
  if(d.startsWith("964"))return d;
  if(d.startsWith("0"))return `964${d.slice(1)}`;
  return `964${d}`;
}
function makeWALink(phone,msg){ return `https://wa.me/${getIraqWA(phone)}?text=${encodeURIComponent(msg)}`; }
function emptyEntry(colors){ const c=colors[0]||{name:"",code:"#000"}; return {name:"",qty:1,colorName:c.name,colorCode:c.code}; }
function emptyItem(colors,products){ return {product:products[0]||"حافظة كيبل",entries:[emptyEntry(colors)],notes:"",image:null}; }
function getItemEntries(item){
  if(item.entries)return item.entries;
  if(item.names)return item.names.map(n=>({name:n,qty:item.qty||1,colorName:item.colorName||"",colorCode:item.colorCode||"#000"}));
  return[];
}
function parseOrderDate(o){ const d=new Date(o.createdAtISO||o.createdAt); return isNaN(d)?new Date():d; }
// ✅ طلب متأخر: مر عليه أكثر من 7 أيام وما خلص
const OVERDUE_DAYS = 7;
function isOverdue(o){
  if (o.status==="مكتمل" || o.status==="ملغي") return false;
  const days = (Date.now() - parseOrderDate(o).getTime()) / (1000*60*60*24);
  return days >= OVERDUE_DAYS;
}
function daysSince(o){
  return Math.floor((Date.now() - parseOrderDate(o).getTime()) / (1000*60*60*24));
}
function fmt(v){ return `${Number(v||0).toLocaleString()} د.ع`; }
function fmtDate(s){
  return new Date(s).toLocaleString("en-GB",{timeZone:"Asia/Baghdad",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hour12:true});
}
function fmtPhone(phone){
  const ar="٠١٢٣٤٥٦٧٨٩";
  let d=String(phone).split("").map(c=>{const i=ar.indexOf(c);return i>-1?i:c;}).join("");
  d=normalizePhone(d);
  return d.length===11?`${d.slice(0,4)} ${d.slice(4,7)} ${d.slice(7)}`:d;
}

// ─── Telegram ───────────────────────────────────────────────────────────────
async function sendTelegram(text) {
  if (!TG_TOKEN || !TG_CHAT_ID) return;
  try {
    await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({chat_id:TG_CHAT_ID, text, parse_mode:"HTML"}),
    });
  } catch(e){ console.error("Telegram error:",e); }
}

function buildTGMsg(order, type="new") {
  const items = order.items.map((item,i)=>{
    const lines = getItemEntries(item).map(e=>`    • ${e.name||"بدون اسم"} — العدد: ${e.qty} — اللون: ${e.colorName}`).join("\n");
    return `${i+1}) ${item.product}\n${lines}`;
  }).join("\n\n");

  const total = Number(order.price||0)+DELIVERY_FEE;
  const prefix = type==="new"?"🧾 <b>طلب جديد</b>":type==="edit"?"✏️ <b>تعديل طلب</b>":`🔄 <b>تحديث حالة</b>`;

  if(type==="status") return `${prefix}\n\n🔢 رقم الطلب: <code>${order.id}</code>\n👤 الزبون: ${order.customer?.name||""}\n📊 الحالة الجديدة: <b>${order.newStatus}</b>`;

  return `${prefix}\n\n🔢 رقم الطلب: <code>${order.id}</code>\n📊 الحالة: <b>${order.status}</b>\n\n👤 الزبون: <b>${order.customer.name}</b>\n📞 الهاتف: <code>${order.customer.phone}</code>\n📍 العنوان: ${order.customer.city} / ${order.customer.address}\n\n📦 المنتجات:\n${items}\n\n💰 السعر: ${fmt(order.price)}\n💳 العربون: ${fmt(order.deposit)}\n⏳ المتبقي: ${fmt(Number(order.price)-Number(order.deposit))}\n🚚 التوصيل: ${fmt(DELIVERY_FEE)}\n✅ <b>الكلي: ${fmt(total)}</b>\n\n📝 ملاحظات: ${order.notes||"لا يوجد"}`;
}

// ─── WhatsApp message ────────────────────────────────────────────────────────
function buildWAMsg(order) {
  const items=order.items.map((item,i)=>{
    const lines=getItemEntries(item).map(e=>`- ${e.name||"بدون اسم"} | العدد: ${e.qty}`).join("\n");
    return `${i+1}) ${item.product}\n${lines}`;
  }).join("\n\n");
  return `السلام عليكم ورحمة الله وبركاته\nعندكم طلب من الطباعة ثلاثية الأبعاد من متجر نايت ستور.\n\nhttps://www.instagram.com/night_99q\n\nاسم الزبون: ${order.customer.name}\nرقم الهاتف: 964${order.customer.phone.replace(/^0/,"")}\nرقم الطلب: ${order.id}\n\nتفاصيل الطلب:\n${items}\n\nمبلغ الطلب: ${fmt(order.price)}\nأجور التوصيل: ${fmt(DELIVERY_FEE)}\n\nشكراً لاختياركم نايت ستور.`;
}

// ─── Invoice PDF ─────────────────────────────────────────────────────────────
function invoiceHtml(order) {
  const rows=order.items.map((item,i)=>{
    const entries=getItemEntries(item).map(e=>`<div>${e.name||"بدون اسم"} - العدد: ${e.qty}</div>`).join("");
    const img=item.image?`<img src="${item.image}" style="width:70px;height:70px;object-fit:cover;border-radius:8px;border:1px solid #cbd5e1;margin-top:6px;"/>`:"";
    return `<tr><td style="border:1px solid #cbd5e1;padding:10px;">${i+1}</td><td style="border:1px solid #cbd5e1;padding:10px;">${item.product}</td><td style="border:1px solid #cbd5e1;padding:10px;">${entries}${img}</td></tr>`;
  }).join("");
  const total=Number(order.price||0)+DELIVERY_FEE;
  return `<div dir="rtl" style="font-family:Tahoma,Arial,sans-serif;padding:28px;color:#111827;background:#fff;width:760px;box-sizing:border-box;"><div style="border-bottom:2px solid #111827;padding-bottom:14px;margin-bottom:18px;"><h1 style="margin:0;font-size:28px;">فاتورة طلب</h1><p style="margin:6px 0 0;font-size:16px;">متجر نايت ستور - الطباعة ثلاثية الأبعاد</p><p style="margin:6px 0 0;"><b>رقم الطلب:</b> ${order.id}</p></div><div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:16px;font-size:15px;"><div><b>اسم الزبون:</b> ${order.customer.name||""}</div><div><b>رقم الهاتف:</b> ${order.customer.phone||""}</div><div><b>المحافظة:</b> ${order.customer.city||""}</div><div><b>العنوان:</b> ${order.customer.address||"غير محدد"}</div></div><table style="width:100%;border-collapse:collapse;margin:14px 0;font-size:15px;"><thead><tr style="background:#eff6ff;"><th style="border:1px solid #cbd5e1;padding:10px;">#</th><th style="border:1px solid #cbd5e1;padding:10px;">المنتج</th><th style="border:1px solid #cbd5e1;padding:10px;">التفاصيل</th></tr></thead><tbody>${rows}</tbody></table><div style="margin-top:18px;padding:16px;border:1px solid #cbd5e1;border-radius:12px;background:#f8fafc;font-size:17px;line-height:2;"><div><b>مبلغ الطلب:</b> ${fmt(order.price)}</div><div><b>العربون:</b> ${fmt(order.deposit)}</div><div><b>المتبقي:</b> ${fmt(Number(order.price||0)-Number(order.deposit||0))}</div><div><b>أجور التوصيل:</b> ${fmt(DELIVERY_FEE)}</div><div><b>شركة التوصيل:</b> ${DELIVERY_COMPANY}</div><div style="border-top:1px solid #cbd5e1;margin-top:8px;padding-top:8px;color:#0f6e56;font-size:18px;"><b>السعر الكلي (مع التوصيل): ${fmt(total)}</b></div></div><p style="margin-top:20px;text-align:center;font-weight:bold;">شكراً لاختياركم متجر نايت ستور</p></div>`;
}

function downloadPDF(html,filename) {
  const h=document.createElement("div");
  h.style.cssText="position:fixed;left:-10000px;top:0;";
  h.innerHTML=html; document.body.appendChild(h);
  html2pdf().set({margin:8,filename,image:{type:"jpeg",quality:0.98},html2canvas:{scale:2,useCORS:true},jsPDF:{unit:"mm",format:"a4",orientation:"portrait"}}).from(h.firstElementChild||h).save().finally(()=>h.remove());
}

// ─── Main App ────────────────────────────────────────────────────────────────
export default function App() {
  const [authorized, setAuthorized] = useState(localStorage.getItem("site_auth")==="yes");
  const [password, setPassword]     = useState("");
  const [darkMode, setDarkMode]     = useState(()=>localStorage.getItem("ns_dark")!=="false");
  const C = darkMode ? DARK : LIGHT;

  useEffect(()=>{ localStorage.setItem("ns_dark", darkMode); },[darkMode]);

  if (!authorized) {
    return (
      <div style={{minHeight:"100vh",background:C.bg,display:"flex",flexDirection:"column",justifyContent:"center",alignItems:"center",gap:16,fontFamily:"Cairo,Tahoma,sans-serif",color:C.text,direction:"rtl"}}>
        <div style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:20,padding:"40px 48px",textAlign:"center",display:"grid",gap:16}}>
          <h1 style={{margin:0,fontSize:24,fontWeight:900}}>🖨 نايت ستور 3D</h1>
          <p style={{margin:0,color:C.textMuted,fontSize:14}}>ادخل رمز الدخول</p>
          <input type="password" value={password} onChange={e=>setPassword(e.target.value)}
            onKeyDown={e=>{ if(e.key==="Enter" && password==="333"){localStorage.setItem("site_auth","yes");setAuthorized(true);} }}
            style={{background:C.surface2,border:`1px solid ${C.border}`,borderRadius:10,padding:"12px 16px",color:C.text,fontSize:16,outline:"none",fontFamily:"Cairo,inherit",width:220,textAlign:"center"}}
            placeholder="••••••"/>
          <button onClick={()=>{ if(password==="333"){localStorage.setItem("site_auth","yes");setAuthorized(true);}else alert("رمز غير صحيح"); }}
            style={{background:C.accent,color:"#fff",border:0,borderRadius:10,padding:"12px 28px",fontSize:15,fontWeight:900,cursor:"pointer",fontFamily:"Cairo,inherit"}}>دخول</button>
        </div>
      </div>
    );
  }

  return <MainApp C={C} darkMode={darkMode} setDarkMode={setDarkMode}/>;
}

function MainApp({C, darkMode, setDarkMode}) {
  const [page, setPage]           = useState("orders");
  const [orders, setOrders]       = useState([]);
  const [loading, setLoading]     = useState(true);
  const [colors, setColors]       = useState(()=>loadLS("ns_colors_v1",defaultColors));
  const [products, setProducts]   = useState(()=>loadLS("ns_products_v1",defaultProducts));
  const [search, setSearch]       = useState("");
  const [statusFilter, setStatusFilter] = useState("الكل");
  const [newColor, setNewColor]   = useState({name:"",code:"#000000"});
  const [newProduct, setNewProduct] = useState("");
  const [editingId, setEditingId] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [form, setForm]           = useState({customerName:"",phone:"",city:"بغداد",address:"",items:[emptyItem(defaultColors,defaultProducts)],price:"",deposit:"",tracking:"",notes:""});
  const [deleteConfirm, setDeleteConfirm] = useState(null); // orderId waiting confirm

  useEffect(()=>{ saveLS("ns_colors_v1",colors); },[colors]);
  useEffect(()=>{ saveLS("ns_products_v1",products); },[products]);

  // ✅ إصلاح الفلتر: normalize + migration تلقائي
  useEffect(()=>{
    async function fetchAndMigrate() {
      setLoading(true);
      const snap = await getDocs(collection(db,"orders"));
      const data = [];
      for (const d of snap.docs) {
        const raw = d.data();
        let cleanStatus = String(raw.status||DEFAULT_STATUS).replace(/[\u200B-\u200F\uFEFF]/g,"").replace(/\s+/g," ").trim();
        // ✅ إذا الحالة مو ضمن القائمة الرسمية، نلاقي أقرب تطابق
        if (!statuses.includes(cleanStatus)) {
          const match = statuses.find(st => cleanStatus.includes(st) || st.includes(cleanStatus));
          cleanStatus = match || DEFAULT_STATUS;
        }
        // ✅ Migration: حدّث Firebase إذا اختلفت الحالة
        if (raw.status !== cleanStatus) {
          try { await updateDoc(doc(db,"orders",d.id),{status:cleanStatus}); } catch{}
        }
        data.push({firebaseId:d.id,...raw,status:cleanStatus});
      }
      setOrders(data);
      setLoading(false);
    }
    fetchAndMigrate();
  },[]);

  const customers = useMemo(()=>{
    const map=new Map();
    orders.forEach(o=>{
      const k=normalizePhone(o.customer?.phone||o.customer?.name||"");
      const old=map.get(k);
      map.set(k,{...o.customer,total:(old?.total||0)+Number(o.price||0),count:(old?.count||0)+1});
    });
    return Array.from(map.values());
  },[orders]);

  // ✅ فلتر مصلح تماماً
  const filteredOrders = useMemo(()=>{
    const q=search.trim().toLowerCase();
    // ✅ إزالة المكررات: نحتفظ بالأحدث (آخر تعديل) لكل رقم طلب
    const byId = new Map();
    for (const o of orders) {
      const existing = byId.get(o.id);
      if (!existing) { byId.set(o.id, o); continue; }
      const tNew = new Date(o.updatedAt || o.createdAtISO || o.createdAt || 0).getTime();
      const tOld = new Date(existing.updatedAt || existing.createdAtISO || existing.createdAt || 0).getTime();
      if (tNew >= tOld) byId.set(o.id, o);
    }
    const unique = Array.from(byId.values());
    return unique
      .sort((a,b)=>Number(a.id?.replace("O-","")||0)-Number(b.id?.replace("O-","")||0))
      .filter(o=>{
        const itemsTxt=o.items?.map(i=>`${i.product} ${getItemEntries(i).map(e=>`${e.name} ${e.colorName}`).join(" ")}`).join(" ")||"";
        const txt=`${o.id} ${o.status} ${o.customer?.name||""} ${o.customer?.phone||""} ${o.customer?.city||""} ${itemsTxt}`.toLowerCase();
        const matchSearch=!q||txt.includes(q);
        const cleanS=(s)=>String(s||"").replace(/[\u200B-\u200F\uFEFF]/g,"").replace(/\s+/g," ").trim();
        const oStatus=cleanS(o.status);
        const fStatus=cleanS(statusFilter);
        const matchStatus = fStatus==="الكل" ? true
          : fStatus==="المتأخرة" ? isOverdue(o)
          : oStatus===fStatus;
        return matchSearch&&matchStatus;
      });
  },[orders,search,statusFilter]);

  // ✅ عدد المكررات الموجودة (لعرضه بزر التنظيف)
  const duplicateCount = useMemo(()=>{
    const seen = new Set();
    let dups = 0;
    for (const o of orders) {
      if (seen.has(o.id)) dups++;
      else seen.add(o.id);
    }
    return dups;
  },[orders]);

  const filteredCustomers = useMemo(()=>{
    const q=search.trim();
    return customers.filter(c=>`${c.name} ${c.phone} ${c.city} ${c.address}`.includes(q));
  },[customers,search]);

  const stats = useMemo(()=>{
    const now=new Date();
    const sw=new Date(now); sw.setDate(now.getDate()-6); sw.setHours(0,0,0,0);
    const sm=new Date(now.getFullYear(),now.getMonth(),1);
    const done=orders.filter(o=>o.status==="مكتمل");
    const wDone=done.filter(o=>parseOrderDate(o)>=sw);
    const mDone=done.filter(o=>parseOrderDate(o)>=sm);
    return {
      total:done.reduce((s,o)=>s+Number(o.price||0),0),
      wTotal:wDone.reduce((s,o)=>s+Number(o.price||0),0),
      mTotal:mDone.reduce((s,o)=>s+Number(o.price||0),0),
      count:done.length,wCount:wDone.length,mCount:mDone.length,
    };
  },[orders]);

  const updItem=(i,p)=>{ const items=[...form.items]; items[i]={...items[i],...p}; setForm({...form,items}); };
  const updEntry=(ii,ei,p)=>{ const item=form.items[ii]; const entries=[...item.entries]; entries[ei]={...entries[ei],...p}; updItem(ii,{entries}); };
  const resetForm=()=>{ setEditingId(null); setForm({customerName:"",phone:"",city:"بغداد",address:"",items:[emptyItem(colors,products)],price:"",deposit:"",tracking:"",notes:""}); };

  async function submitOrder() {
    if(!form.customerName||!form.phone||!form.items[0]?.product) return alert("اكتب اسم الزبون ورقم الهاتف وتفاصيل الطلب");
    const cleanItems=form.items.map(item=>({...item,entries:item.entries.map(e=>({...e,name:e.name.trim(),qty:Number(e.qty||1)})).filter(e=>e.name)}));
    const old=orders.find(o=>o.id===editingId);
    const saved={
      id:editingId||`O-${5001+orders.length}`,
      status:old?.status||DEFAULT_STATUS,
      customer:{name:form.customerName,phone:normalizePhone(form.phone),city:form.city,address:form.address},
      items:cleanItems,price:Number(form.price||0),deposit:Number(form.deposit||0),
      tracking:form.tracking,notes:form.notes,
      createdAt:old?.createdAt||new Date().toLocaleString("ar-IQ"),
      createdAtISO:old?.createdAtISO||new Date().toISOString(),
      updatedAt:new Date().toLocaleString("ar-IQ"),
    };
    if(editingId){
      // ✅ نحدّث كل النسخ المكررة بنفس الـ id
      const allCopies = orders.filter(o=>o.id===editingId && o.firebaseId);
      for (const copy of allCopies) {
        try { await updateDoc(doc(db,"orders",copy.firebaseId),saved); } catch{}
      }
      setOrders(orders.map(o=>o.id===editingId?{...saved,firebaseId:o.firebaseId}:o));
      sendTelegram(buildTGMsg(saved,"edit"));
    } else {
      const ref=await addDoc(collection(db,"orders"),saved);
      setOrders([...orders,{...saved,firebaseId:ref.id}]);
      sendTelegram(buildTGMsg(saved,"new"));
    }
    resetForm(); setPage("orders");
  }

  function startEdit(order) {
    setEditingId(order.id);
    setForm({
      customerName:order.customer?.name||"",phone:order.customer?.phone||"",city:order.customer?.city||"بغداد",address:order.customer?.address||"",
      items:order.items.map(item=>({product:item.product,notes:item.notes||"",image:item.image||null,entries:getItemEntries(item).map(e=>({name:e.name||"",qty:e.qty||1,colorName:e.colorName||colors[0]?.name||"",colorCode:e.colorCode||colors[0]?.code||"#000"}))})),
      price:String(order.price||""),deposit:String(order.deposit||""),tracking:order.tracking||"",notes:order.notes||"",
    });
    setPage("newOrder");
  }

  async function updateStatus(id,status) {
    const o=orders.find(x=>x.id===id);
    // ✅ نحدّث كل النسخ المكررة بنفس الـ id بـ Firebase (مو وحدة بس)
    const allCopies = orders.filter(x=>x.id===id && x.firebaseId);
    for (const copy of allCopies) {
      try { await updateDoc(doc(db,"orders",copy.firebaseId),{status}); } catch{}
    }
    setOrders(orders.map(x=>x.id===id?{...x,status}:x));
    sendTelegram(buildTGMsg({...o,newStatus:status},"status"));
  }

  async function delOrder(id) {
    // ✅ نحذف كل النسخ المكررة بنفس الـ id
    const allCopies = orders.filter(x=>x.id===id && x.firebaseId);
    for (const copy of allCopies) {
      try { await deleteDoc(doc(db,"orders",copy.firebaseId)); } catch{}
    }
    setOrders(orders.filter(x=>x.id!==id));
    setDeleteConfirm(null);
  }

  function addColor() {
    const name=newColor.name.trim(); if(!name) return;
    if(colors.some(c=>c.name===name)) return alert("هذا اللون موجود");
    setColors([...colors,{name,code:newColor.code}]);
    setNewColor({name:"",code:"#000000"});
  }
  function addProduct() {
    const p=newProduct.trim(); if(!p) return;
    if(products.includes(p)) return alert("هذا المنتج موجود");
    setProducts([...products,p]); setNewProduct("");
  }
  const [fixing, setFixing] = useState(false);
  async function fixAllStatuses() {
    if (!confirm("سيتم فحص وإصلاح حالات كل الطلبات. متأكد؟")) return;
    setFixing(true);
    const clean = (s) => String(s||"").replace(/[\u200B-\u200F\uFEFF]/g,"").replace(/\s+/g," ").trim();
    let fixed = 0;
    const updated = [];
    for (const o of orders) {
      let st = clean(o.status);
      if (!statuses.includes(st)) {
        const m = statuses.find(x => st.includes(x) || x.includes(st));
        st = m || DEFAULT_STATUS;
      }
      if (o.status !== st && o.firebaseId) {
        try { await updateDoc(doc(db,"orders",o.firebaseId),{status:st}); fixed++; } catch{}
      }
      updated.push({...o, status:st});
    }
    setOrders(updated);
    setFixing(false);
    alert("تم إصلاح " + fixed + " طلب");
  }

  // ✅ تنظيف المكررات: يحذف النسخ الزائدة من Firebase ويحتفظ بالأحدث
  const [cleaning, setCleaning] = useState(false);
  async function removeDuplicates() {
    const dups = duplicateCount;
    if (dups === 0) { alert("ما في طلبات مكررة 👍"); return; }
    if (!confirm("في " + dups + " طلب مكرر. سيتم حذف النسخ الزائدة والاحتفاظ بالأحدث لكل طلب. متأكد؟")) return;
    setCleaning(true);

    // نجمّع كل النسخ حسب الـ id
    const groups = new Map();
    for (const o of orders) {
      if (!groups.has(o.id)) groups.set(o.id, []);
      groups.get(o.id).push(o);
    }

    const keep = [];
    let deleted = 0;
    for (const [id, copies] of groups) {
      if (copies.length === 1) { keep.push(copies[0]); continue; }
      // نرتب: الأحدث أول (حسب updatedAt ثم createdAtISO)
      copies.sort((a,b) => {
        const tA = new Date(a.updatedAt||a.createdAtISO||a.createdAt||0).getTime();
        const tB = new Date(b.updatedAt||b.createdAtISO||b.createdAt||0).getTime();
        return tB - tA;
      });
      keep.push(copies[0]); // نحتفظ بالأحدث
      // نحذف الباقي من Firebase
      for (let i = 1; i < copies.length; i++) {
        if (copies[i].firebaseId) {
          try { await deleteDoc(doc(db,"orders",copies[i].firebaseId)); deleted++; } catch{}
        }
      }
    }

    setOrders(keep);
    setCleaning(false);
    alert("تم حذف " + deleted + " نسخة مكررة ✅");
  }

  // ✅ نسخة احتياطية: تصدير كل الطلبات لملف JSON
  function exportBackup() {
    const backup = {
      exportedAt: new Date().toISOString(),
      version: 1,
      orders: orders.map(({firebaseId, ...rest}) => rest),
      colors,
      products,
    };
    const blob = new Blob([JSON.stringify(backup, null, 2)], {type:"application/json"});
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `backup-night-store-${new Date().toISOString().slice(0,10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // ✅ استعادة من ملف JSON
  const [restoring, setRestoring] = useState(false);
  async function importBackup(file) {
    if (!file) return;
    if (!confirm("سيتم استعادة الطلبات من الملف. الطلبات الحالية تبقى موجودة. متأكد؟")) return;
    setRestoring(true);
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      if (!data.orders || !Array.isArray(data.orders)) {
        alert("الملف غير صالح");
        setRestoring(false);
        return;
      }
      const existingIds = new Set(orders.map(o => o.id));
      let added = 0;
      const newOnes = [];
      for (const o of data.orders) {
        if (existingIds.has(o.id)) continue; // ما نكرر
        const ref = await addDoc(collection(db,"orders"), o);
        newOnes.push({...o, firebaseId:ref.id});
        added++;
      }
      setOrders([...orders, ...newOnes]);
      if (data.colors && Array.isArray(data.colors)) setColors(data.colors);
      if (data.products && Array.isArray(data.products)) setProducts(data.products);
      alert("تم استعادة " + added + " طلب");
    } catch(e) {
      alert("خطأ بقراءة الملف: " + e.message);
    }
    setRestoring(false);
  }

  function exportCustomersPDF() {
    const rows=filteredCustomers.map((c,i)=>`<tr><td style="border:1px solid #cbd5e1;padding:10px;">${i+1}</td><td style="border:1px solid #cbd5e1;padding:10px;">${c.name||""}</td><td style="border:1px solid #cbd5e1;padding:10px;">${c.phone||""}</td><td style="border:1px solid #cbd5e1;padding:10px;">${c.city||""}</td><td style="border:1px solid #cbd5e1;padding:10px;">${c.address||""}</td><td style="border:1px solid #cbd5e1;padding:10px;">${c.count||0}</td><td style="border:1px solid #cbd5e1;padding:10px;">${fmt(c.total)}</td></tr>`).join("");
    downloadPDF(`<div dir="rtl" style="font-family:Tahoma;padding:28px;color:#111827;background:#fff;width:900px;"><h1>تقرير الزبائن - متجر نايت ستور</h1><p>تاريخ التصدير: ${new Date().toLocaleString("ar-IQ")}</p><table style="width:100%;border-collapse:collapse;font-size:14px;"><thead><tr style="background:#eff6ff;"><th style="border:1px solid #cbd5e1;padding:10px;">#</th><th style="border:1px solid #cbd5e1;padding:10px;">الاسم</th><th style="border:1px solid #cbd5e1;padding:10px;">الهاتف</th><th style="border:1px solid #cbd5e1;padding:10px;">المحافظة</th><th style="border:1px solid #cbd5e1;padding:10px;">العنوان</th><th style="border:1px solid #cbd5e1;padding:10px;">الطلبات</th><th style="border:1px solid #cbd5e1;padding:10px;">الإجمالي</th></tr></thead><tbody>${rows}</tbody></table></div>`,"customers.pdf");
  }

  // ─── Styles ───────────────────────────────────────────────────────────────
  const SIDEBAR_W = sidebarOpen ? 220 : 64;
  const navItems = [
    {key:"orders",  icon:"📦", label:"الطلبات"},
    {key:"customers",icon:"👥",label:"الزبائن"},
    {key:"colors",  icon:"🎨", label:"الألوان"},
    {key:"products",icon:"🛍", label:"المنتجات"},
    {key:"reports", icon:"📊", label:"التقارير"},
  ];

  const inp = {border:`1px solid ${C.border}`,borderRadius:10,padding:"10px 12px",fontSize:14,outline:"none",background:C.surface2,color:C.text,fontFamily:"Cairo,inherit",minWidth:0,width:"100%",boxSizing:"border-box"};
  const lbl = {display:"grid",gap:6,fontWeight:800,color:C.textMuted,fontSize:13};
  const card = {background:C.surface,border:`1px solid ${C.border}`,borderRadius:14,padding:18};

  return (
    <div style={{display:"flex",minHeight:"100vh",background:C.bg,color:C.text,fontFamily:"Cairo,Tahoma,sans-serif",direction:"rtl"}}>

      {/* ── Sidebar ── */}
      <div style={{width:SIDEBAR_W,minHeight:"100vh",background:darkMode?"#0d1117":"#1e293b",borderLeft:`1px solid ${C.border}`,display:"flex",flexDirection:"column",transition:"width 0.2s",flexShrink:0,position:"sticky",top:0,height:"100vh",overflow:"hidden"}}>
        {/* Logo */}
        <div style={{padding:"18px 14px",borderBottom:`1px solid rgba(255,255,255,0.08)`}}>
          {sidebarOpen
            ? <div><div style={{fontSize:16,fontWeight:900,color:"#fff",whiteSpace:"nowrap"}}>🖨 نايت ستور</div><div style={{fontSize:11,color:"rgba(255,255,255,0.4)",marginTop:2}}>3D Print Orders</div></div>
            : <div style={{fontSize:20,textAlign:"center"}}>🖨</div>
          }
        </div>
        {/* Nav */}
        <nav style={{flex:1,padding:"10px 8px",display:"flex",flexDirection:"column",gap:4}}>
          {navItems.map(n=>(
            <button key={n.key} onClick={()=>setPage(n.key)}
              style={{display:"flex",alignItems:"center",gap:10,padding:sidebarOpen?"10px 12px":"10px",borderRadius:10,border:"none",cursor:"pointer",fontFamily:"Cairo,inherit",fontSize:13,fontWeight:700,transition:"all 0.15s",background:page===n.key?"rgba(88,166,255,0.15)":"transparent",color:page===n.key?"#58a6ff":"rgba(255,255,255,0.6)",width:"100%",textAlign:"right",justifyContent:sidebarOpen?"flex-start":"center"}}>
              <span style={{fontSize:18,flexShrink:0}}>{n.icon}</span>
              {sidebarOpen && <span style={{whiteSpace:"nowrap"}}>{n.label}</span>}
              {sidebarOpen && page===n.key && <span style={{marginRight:"auto",width:4,height:4,borderRadius:"50%",background:"#58a6ff",display:"inline-block"}}/>}
            </button>
          ))}
          <button onClick={()=>{resetForm();setPage("newOrder");}}
            style={{display:"flex",alignItems:"center",gap:10,padding:sidebarOpen?"10px 12px":"10px",borderRadius:10,border:"none",cursor:"pointer",fontFamily:"Cairo,inherit",fontSize:13,fontWeight:800,background:"#58a6ff",color:"#0d1117",marginTop:8,justifyContent:sidebarOpen?"flex-start":"center",width:"100%"}}>
            <span style={{fontSize:18}}>➕</span>
            {sidebarOpen && <span>طلب جديد</span>}
          </button>
        </nav>
        {/* Bottom */}
        <div style={{padding:"10px 8px",borderTop:`1px solid rgba(255,255,255,0.08)`,display:"flex",flexDirection:"column",gap:6}}>
          <button onClick={()=>setDarkMode(d=>!d)}
            style={{display:"flex",alignItems:"center",gap:10,padding:sidebarOpen?"9px 12px":"9px",borderRadius:10,border:"none",cursor:"pointer",fontFamily:"Cairo,inherit",fontSize:12,fontWeight:700,background:"transparent",color:"rgba(255,255,255,0.5)",width:"100%",justifyContent:sidebarOpen?"flex-start":"center"}}>
            <span style={{fontSize:16}}>{darkMode?"☀️":"🌙"}</span>
            {sidebarOpen && <span>{darkMode?"وضع فاتح":"وضع داكن"}</span>}
          </button>
          <button onClick={()=>setSidebarOpen(o=>!o)}
            style={{display:"flex",alignItems:"center",gap:10,padding:sidebarOpen?"9px 12px":"9px",borderRadius:10,border:"none",cursor:"pointer",fontFamily:"Cairo,inherit",fontSize:12,fontWeight:700,background:"transparent",color:"rgba(255,255,255,0.4)",width:"100%",justifyContent:sidebarOpen?"flex-start":"center"}}>
            <span style={{fontSize:16}}>{sidebarOpen?"◀":"▶"}</span>
            {sidebarOpen && <span>طي القائمة</span>}
          </button>
          <button onClick={()=>{ localStorage.removeItem("site_auth"); window.location.reload(); }}
            style={{display:"flex",alignItems:"center",gap:10,padding:sidebarOpen?"9px 12px":"9px",borderRadius:10,border:"none",cursor:"pointer",fontFamily:"Cairo,inherit",fontSize:12,fontWeight:700,background:"transparent",color:"rgba(248,81,73,0.7)",width:"100%",justifyContent:sidebarOpen?"flex-start":"center"}}>
            <span style={{fontSize:16}}>🚪</span>
            {sidebarOpen && <span>تسجيل الخروج</span>}
          </button>
        </div>
      </div>

      {/* ── Main Content ── */}
      <div style={{flex:1,padding:"20px 24px",overflowY:"auto",minWidth:0}}>

        {/* ── Stats ── */}
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(130px,1fr))",gap:10,marginBottom:20}}>
          {[
            ["كل الطلبات",orders.length,C.accent],
            ["الزبائن",customers.length,"#c084fc"],
            ["تحت التصميم",orders.filter(o=>o.status==="تحت التصميم").length,"#60a5fa"],
            ["تحت الطباعة",orders.filter(o=>o.status==="تحت الطباعة").length,"#fbbf24"],
            ["قيد التوصيل",orders.filter(o=>o.status==="قيد التوصيل").length,"#a78bfa"],
            ["⚠️ متأخرة",orders.filter(isOverdue).length,"#f87171"],
            ["مكتملة الأسبوع",fmt(stats.wTotal),C.green],
            ["مكتملة الشهر",fmt(stats.mTotal),"#34d399"],
          ].map(([label,val,color])=>(
            <div key={label} style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:12,padding:"12px 14px"}}>
              <div style={{fontSize:11,color:C.textMuted,marginBottom:5}}>{label}</div>
              <div style={{fontSize:20,fontWeight:900,color}}>{val}</div>
            </div>
          ))}
        </div>

        {/* ✅ تنبيه المكررات */}
        {duplicateCount>0 && (
          <div style={{background:C.redBg,border:`1px solid ${C.red}`,borderRadius:12,padding:"12px 16px",marginBottom:14,display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:10}}>
            <span style={{color:C.red,fontWeight:800,fontSize:14}}>⚠️ في {duplicateCount} طلب مكرر — يسبب مشاكل بالحالات</span>
            <button style={{background:C.red,color:"#fff",border:0,borderRadius:8,padding:"7px 16px",cursor:cleaning?"wait":"pointer",fontWeight:800,fontFamily:"Cairo,inherit",fontSize:13,opacity:cleaning?0.6:1}} onClick={removeDuplicates} disabled={cleaning}>{cleaning?"جاري التنظيف...":"🧹 تنظيف الآن"}</button>
          </div>
        )}

        {/* ── Search + Filter ── */}
        <input style={{...inp,marginBottom:12,padding:"12px 16px",fontSize:14}} placeholder="بحث باسم الزبون أو الرقم أو الطلب أو اللون..." value={search} onChange={e=>setSearch(e.target.value)}/>
        <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:20}}>
          {["الكل",...statuses].map(st=>{
            const active=statusFilter===st;
            const ss=STATUS_STYLE[st]||{};
            return <button key={st} onClick={()=>setStatusFilter(st)}
              style={{border:active?`1px solid ${ss.dot||C.accent}`:`1px solid ${C.border}`,background:active?(ss.bg||C.accentBg):"transparent",color:active?(ss.color||C.accent):C.textMuted,borderRadius:999,padding:"6px 14px",cursor:"pointer",fontWeight:700,fontFamily:"Cairo,inherit",fontSize:12}}>
              {st}
            </button>;
          })}
          <button onClick={()=>setStatusFilter("المتأخرة")}
            style={{border:statusFilter==="المتأخرة"?`1px solid #f87171`:`1px solid ${C.border}`,background:statusFilter==="المتأخرة"?"#250a0a":"transparent",color:statusFilter==="المتأخرة"?"#f87171":C.textMuted,borderRadius:999,padding:"6px 14px",cursor:"pointer",fontWeight:700,fontFamily:"Cairo,inherit",fontSize:12}}>
            ⚠️ المتأخرة
          </button>
        </div>

        {/* ── Pages ── */}
        {loading && <div style={{color:C.textMuted,padding:40,textAlign:"center"}}>⏳ جاري التحميل...</div>}

        {!loading && page==="orders" && (
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(320px,1fr))",gap:16}}>
            {filteredOrders.map(o=>(
              <OrderCard key={o.id} order={o} C={C} updateStatus={updateStatus} delOrder={(id)=>setDeleteConfirm(id)} startEdit={startEdit}/>
            ))}
            {filteredOrders.length===0 && <div style={{color:C.textMuted,padding:40,textAlign:"center",gridColumn:"1/-1"}}>لا توجد طلبات</div>}
          </div>
        )}

        {!loading && page==="customers" && (
          <>
            <button style={{background:C.accent,color:"#fff",border:0,borderRadius:8,padding:"9px 16px",cursor:"pointer",fontWeight:800,fontFamily:"Cairo,inherit",fontSize:13,marginBottom:14}} onClick={exportCustomersPDF}>تحميل PDF</button>
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(270px,1fr))",gap:14}}>
              {filteredCustomers.map(c=>(
                <div key={c.phone} style={card}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
                    <b style={{color:C.text,fontSize:15}}>{c.name}</b>
                    <a style={{background:C.greenBg,border:`1px solid ${C.green}`,color:C.green,borderRadius:8,padding:"6px 10px",textDecoration:"none",fontSize:12,fontWeight:800}} href={makeWALink(c.phone,`مرحبا ${c.name}، عدنا عروض جديدة من متجر 3D`)} target="_blank" rel="noreferrer">واتساب</a>
                  </div>
                  {[["الهاتف",c.phone],["العنوان",`${c.city} / ${c.address}`],["عدد الطلبات",c.count]].map(([l,v])=>(
                    <p key={l} style={{color:C.textMuted,fontSize:13,margin:"4px 0"}}><span style={{color:C.textDim}}>{l}: </span>{v}</p>
                  ))}
                  <p style={{color:C.green,fontSize:14,fontWeight:800,margin:"8px 0 0"}}>{c.total.toLocaleString()} د.ع</p>
                </div>
              ))}
            </div>
          </>
        )}

        {!loading && page==="colors" && (
          <div style={{...card,maxWidth:700,display:"grid",gap:14}}>
            <h2 style={{margin:0,color:C.text,fontWeight:900,fontSize:20}}>مخزن الألوان</h2>
            <div style={{display:"grid",gridTemplateColumns:"1fr auto auto",gap:10,alignItems:"center"}}>
              <input style={inp} value={newColor.name} onChange={e=>setNewColor({...newColor,name:e.target.value})} placeholder="اسم اللون مثال: أسود PLA مطفي"/>
              <input type="color" style={{height:42,width:60,border:`1px solid ${C.border}`,borderRadius:10,background:C.surface2,padding:4,cursor:"pointer"}} value={newColor.code} onChange={e=>setNewColor({...newColor,code:e.target.value})}/>
              <button style={{background:C.accent,color:"#fff",border:0,borderRadius:8,padding:"10px 16px",cursor:"pointer",fontWeight:800,fontFamily:"Cairo,inherit",fontSize:13}} onClick={addColor}>إضافة</button>
            </div>
            <div style={{display:"flex",flexWrap:"wrap",gap:10}}>
              {colors.map(c=>(
                <span key={c.name} style={{display:"inline-flex",alignItems:"center",gap:8,background:C.surface2,color:C.text,border:`1px solid ${C.border}`,borderRadius:999,padding:"7px 12px",fontWeight:800,fontSize:13}}>
                  <span style={{width:14,height:14,borderRadius:"50%",background:c.code,border:`1px solid ${C.border2}`,display:"inline-block"}}/>
                  {c.name}
                  <button style={{marginRight:4,border:0,background:C.redBg,color:C.red,borderRadius:999,cursor:"pointer",fontWeight:900,padding:"2px 7px"}} onClick={()=>setColors(colors.filter(x=>x.name!==c.name))}>×</button>
                </span>
              ))}
            </div>
          </div>
        )}

        {!loading && page==="products" && (
          <div style={{...card,maxWidth:700,display:"grid",gap:14}}>
            <h2 style={{margin:0,color:C.text,fontWeight:900,fontSize:20}}>المنتجات</h2>
            <div style={{display:"grid",gridTemplateColumns:"1fr auto",gap:10,alignItems:"center"}}>
              <input style={inp} value={newProduct} onChange={e=>setNewProduct(e.target.value)} placeholder="اسم المنتج"/>
              <button style={{background:C.accent,color:"#fff",border:0,borderRadius:8,padding:"10px 16px",cursor:"pointer",fontWeight:800,fontFamily:"Cairo,inherit",fontSize:13}} onClick={addProduct}>إضافة</button>
            </div>
            <div style={{display:"flex",flexWrap:"wrap",gap:10}}>
              {products.map(p=>(
                <span key={p} style={{display:"inline-flex",alignItems:"center",gap:8,background:C.surface2,color:C.text,border:`1px solid ${C.border}`,borderRadius:999,padding:"7px 12px",fontWeight:800,fontSize:13}}>
                  {p}
                  <button style={{marginRight:4,border:0,background:C.redBg,color:C.red,borderRadius:999,cursor:"pointer",fontWeight:900,padding:"2px 7px"}} onClick={()=>setProducts(products.filter(x=>x!==p))}>×</button>
                </span>
              ))}
            </div>
          </div>
        )}

        {!loading && page==="reports" && (
          <div style={{...card,maxWidth:960,display:"grid",gap:16}}>
            <h2 style={{margin:0,color:C.text,fontWeight:900,fontSize:20}}>التقارير</h2>
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(140px,1fr))",gap:10}}>
              {[["المكتملة",stats.count,C.green],["إجمالي مكتملة",fmt(stats.total),C.green],["أسبوعية",`${stats.wCount} طلب`,C.accent],["مبالغ الأسبوع",fmt(stats.wTotal),C.accent],["شهرية",`${stats.mCount} طلب`,"#c084fc"],["مبالغ الشهر",fmt(stats.mTotal),"#c084fc"]].map(([l,v,c])=>(
                <div key={l} style={{background:C.surface2,border:`1px solid ${C.border}`,borderRadius:12,padding:"12px 14px"}}>
                  <div style={{fontSize:11,color:C.textMuted,marginBottom:5}}>{l}</div>
                  <div style={{fontSize:18,fontWeight:900,color:c}}>{v}</div>
                </div>
              ))}
            </div>
            <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
              <button style={{background:C.accent,color:"#fff",border:0,borderRadius:8,padding:"9px 16px",cursor:"pointer",fontWeight:800,fontFamily:"Cairo,inherit",fontSize:13}} onClick={exportCustomersPDF}>تحميل قائمة الزبائن PDF</button>
              <button style={{background:C.yellowBg,color:C.yellow,border:`1px solid ${C.yellow}`,borderRadius:8,padding:"9px 16px",cursor:fixing?"wait":"pointer",fontWeight:800,fontFamily:"Cairo,inherit",fontSize:13,opacity:fixing?0.6:1}} onClick={fixAllStatuses} disabled={fixing}>{fixing?"⚙️ جاري الإصلاح...":"🔧 إصلاح حالات الطلبات"}</button>
              <button style={{background:duplicateCount>0?C.redBg:C.surface2,color:duplicateCount>0?C.red:C.textMuted,border:`1px solid ${duplicateCount>0?C.red:C.border}`,borderRadius:8,padding:"9px 16px",cursor:cleaning?"wait":"pointer",fontWeight:800,fontFamily:"Cairo,inherit",fontSize:13,opacity:cleaning?0.6:1}} onClick={removeDuplicates} disabled={cleaning}>{cleaning?"⚙️ جاري التنظيف...":`🧹 حذف المكررات${duplicateCount>0?` (${duplicateCount})`:""}`}</button>
            </div>

            <div style={{borderTop:`1px solid ${C.border}`,paddingTop:16,marginTop:4}}>
              <h3 style={{margin:"0 0 12px",color:C.text,fontWeight:800,fontSize:16}}>💾 النسخ الاحتياطي</h3>
              <p style={{margin:"0 0 12px",color:C.textMuted,fontSize:13}}>احفظ نسخة من كل بياناتك بشكل دوري حتى ما تخسر شي</p>
              <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
                <button style={{background:C.greenBg,color:C.green,border:`1px solid ${C.green}`,borderRadius:8,padding:"9px 16px",cursor:"pointer",fontWeight:800,fontFamily:"Cairo,inherit",fontSize:13}} onClick={exportBackup}>⬇️ تنزيل نسخة احتياطية</button>
                <label style={{background:C.surface2,color:C.text,border:`1px solid ${C.border}`,borderRadius:8,padding:"9px 16px",cursor:restoring?"wait":"pointer",fontWeight:800,fontFamily:"Cairo,inherit",fontSize:13,opacity:restoring?0.6:1}}>
                  {restoring?"⏳ جاري الاستعادة...":"⬆️ استعادة من ملف"}
                  <input type="file" accept=".json" style={{display:"none"}} disabled={restoring} onChange={e=>importBackup(e.target.files[0])}/>
                </label>
              </div>
            </div>
            <div style={{overflowX:"auto",background:C.surface2,borderRadius:12,border:`1px solid ${C.border}`}}>
              <table style={{width:"100%",borderCollapse:"collapse",minWidth:600,fontSize:13}}>
                <thead><tr style={{background:C.surface}}>
                  {["الاسم","الهاتف","المحافظة","العنوان","الطلبات","الإجمالي"].map(h=>(
                    <th key={h} style={{padding:"10px 12px",textAlign:"right",color:C.textMuted,borderBottom:`1px solid ${C.border}`,fontWeight:700}}>{h}</th>
                  ))}
                </tr></thead>
                <tbody>{filteredCustomers.map(c=>(
                  <tr key={c.phone} style={{borderBottom:`1px solid ${C.border}`}}>
                    {[c.name,c.phone,c.city,c.address,c.count,fmt(c.total)].map((v,i)=>(
                      <td key={i} style={{padding:"9px 12px",color:i===5?C.green:C.text}}>{v}</td>
                    ))}
                  </tr>
                ))}</tbody>
              </table>
            </div>
          </div>
        )}

        {page==="newOrder" && (
          <div style={{...card,maxWidth:920,display:"grid",gap:14}}>
            <h2 style={{margin:0,color:C.text,fontWeight:900,fontSize:20}}>{editingId?`تعديل الطلب ${editingId}`:"إضافة طلب جديد"}</h2>
            <h3 style={{margin:"10px 0 0",color:C.accent,borderBottom:`1px solid ${C.border}`,paddingBottom:8,fontWeight:800,fontSize:15}}>معلومات الزبون</h3>
            <Inp label="اسم الزبون" value={form.customerName} onChange={v=>setForm({...form,customerName:v})} C={C}/>
            <Inp label="رقم الهاتف" value={form.phone} onChange={v=>setForm({...form,phone:v})} C={C}/>
            <label style={lbl}>المحافظة
              <input style={inp} list="plist" value={form.city} onChange={e=>setForm({...form,city:e.target.value})}/>
              <datalist id="plist">{provinces.map(p=><option key={p} value={p}/>)}</datalist>
            </label>
            <Inp label="العنوان التفصيلي" value={form.address} onChange={v=>setForm({...form,address:v})} C={C}/>

            <h3 style={{margin:"10px 0 0",color:C.accent,borderBottom:`1px solid ${C.border}`,paddingBottom:8,fontWeight:800,fontSize:15}}>تفاصيل المنتجات</h3>
            {form.items.map((item,idx)=>(
              <div key={idx} style={{display:"grid",gap:12,background:C.surface2,border:`1px solid ${C.border}`,borderRadius:14,padding:16}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                  <b style={{color:C.text,fontSize:14}}>منتج رقم {idx+1}</b>
                  {form.items.length>1 && <button style={{border:0,background:C.redBg,color:C.red,borderRadius:8,padding:"7px 10px",cursor:"pointer",fontWeight:800,fontFamily:"Cairo,inherit",fontSize:12}} onClick={()=>setForm({...form,items:form.items.filter((_,i)=>i!==idx)})}>حذف المنتج</button>}
                </div>
                <label style={lbl}>المنتج
                  <select style={inp} value={item.product} onChange={e=>updItem(idx,{product:e.target.value})}>
                    {products.map(p=><option key={p} value={p}>{p}</option>)}
                  </select>
                </label>
                {item.product==="قطعة خاصة" && (
                  <div style={{display:"grid",gap:10,background:C.surface,border:`1px dashed ${C.border2}`,borderRadius:12,padding:12}}>
                    <label style={lbl}>صورة القطعة الخاصة</label>
                    <input style={inp} type="file" accept="image/*" onChange={e=>{
                      const file=e.target.files[0]; if(!file) return;
                      const reader=new FileReader(); const canvas=document.createElement("canvas"); const img=new Image();
                      reader.onload=()=>{img.src=reader.result;};
                      img.onload=()=>{const MAX=600;let w=img.width,h=img.height;if(w>MAX){h*=MAX/w;w=MAX;}canvas.width=w;canvas.height=h;canvas.getContext("2d").drawImage(img,0,0,w,h);updItem(idx,{image:canvas.toDataURL("image/jpeg",0.7)});};
                      reader.readAsDataURL(file);
                    }}/>
                    {item.image && <img src={item.image} alt="صورة" style={{width:150,maxHeight:150,objectFit:"cover",borderRadius:10,border:`1px solid ${C.border}`}}/>}
                  </div>
                )}
                <div style={{display:"grid",gap:8}}>
                  <b style={{color:C.textMuted,fontSize:13}}>الأسماء — لكل اسم لون وعدد خاص</b>
                  {item.entries.map((entry,ei)=>(
                    <div key={ei} style={{display:"grid",gridTemplateColumns:"1.5fr 80px 1fr 140px auto",gap:8,alignItems:"center"}}>
                      <input style={inp} value={entry.name} onChange={e=>updEntry(idx,ei,{name:e.target.value})} placeholder={`الاسم ${ei+1}`}/>
                      <input style={inp} type="number" value={entry.qty} onChange={e=>updEntry(idx,ei,{qty:e.target.value})} placeholder="العدد"/>
                      <select style={inp} value={entry.colorName} onChange={e=>{const c=colors.find(x=>x.name===e.target.value);updEntry(idx,ei,{colorName:c?.name||"",colorCode:c?.code||"#000"});}}>
                        {colors.map(c=><option key={c.name} value={c.name}>{c.name}</option>)}
                      </select>
                      <div style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:8,padding:"8px 10px",display:"flex",gap:8,alignItems:"center",fontWeight:800,fontSize:13,color:C.text}}>
                        <span style={{width:12,height:12,borderRadius:"50%",background:entry.colorCode,border:`1px solid ${C.border2}`,display:"inline-block"}}/>
                        {entry.colorName}
                      </div>
                      {item.entries.length>1 && <button style={{border:0,background:C.redBg,color:C.red,borderRadius:8,padding:"8px 10px",cursor:"pointer",fontWeight:800,fontFamily:"Cairo,inherit",fontSize:12}} onClick={()=>{ const it=form.items[idx]; updItem(idx,{entries:it.entries.filter((_,i)=>i!==ei)}); }}>حذف</button>}
                    </div>
                  ))}
                  <button style={{border:0,background:C.accentBg,color:C.accent,borderRadius:8,padding:"8px 12px",cursor:"pointer",fontWeight:800,fontFamily:"Cairo,inherit",fontSize:12,width:"fit-content"}} onClick={()=>updItem(idx,{entries:[...item.entries,emptyEntry(colors)]})}>+ إضافة اسم</button>
                </div>
                <Inp label="ملاحظات المنتج" value={item.notes} onChange={v=>updItem(idx,{notes:v})} C={C}/>
              </div>
            ))}
            <button style={{border:`1px dashed ${C.accent}`,background:C.accentBg,color:C.accent,borderRadius:12,padding:12,cursor:"pointer",fontWeight:900,fontFamily:"Cairo,inherit",fontSize:14}} onClick={()=>setForm({...form,items:[...form.items,emptyItem(colors,products)]})}>+ إضافة منتج آخر</button>

            <h3 style={{margin:"10px 0 0",color:C.accent,borderBottom:`1px solid ${C.border}`,paddingBottom:8,fontWeight:800,fontSize:15}}>الدفع والتوصيل</h3>
            <Inp label="السعر" type="number" value={form.price} onChange={v=>setForm({...form,price:v})} C={C}/>
            <Inp label="العربون" type="number" value={form.deposit} onChange={v=>setForm({...form,deposit:v})} C={C}/>
            <Inp label="رقم تتبع الوسيط (اختياري)" value={form.tracking} onChange={v=>setForm({...form,tracking:v})} C={C}/>
            <Inp label="ملاحظات عامة" value={form.notes} onChange={v=>setForm({...form,notes:v})} C={C}/>
            <div style={{background:C.accentBg,color:C.accent,border:`1px solid ${C.border}`,padding:12,borderRadius:10,fontSize:13}}>
              شركة التوصيل: <b>{DELIVERY_COMPANY}</b> — أجرة التوصيل: <b>{DELIVERY_FEE.toLocaleString()} د.ع</b>
            </div>
            <div style={{display:"flex",gap:10}}>
              <button style={{border:0,background:C.green,color:"#fff",borderRadius:10,padding:14,fontSize:16,cursor:"pointer",fontWeight:900,fontFamily:"Cairo,inherit"}} onClick={submitOrder}>{editingId?"حفظ التعديل":"حفظ الطلب"}</button>
              {editingId && <button style={{border:`1px solid ${C.border}`,background:"transparent",color:C.textMuted,borderRadius:10,padding:14,fontSize:14,cursor:"pointer",fontWeight:700,fontFamily:"Cairo,inherit"}} onClick={resetForm}>إلغاء</button>}
            </div>
          </div>
        )}
      </div>

      {/* ── Delete Confirm Modal ── */}
      {deleteConfirm && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.7)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000}}>
          <div style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:16,padding:32,textAlign:"center",display:"grid",gap:16,maxWidth:340}}>
            <div style={{fontSize:40}}>🗑</div>
            <h3 style={{margin:0,color:C.text,fontSize:18}}>حذف الطلب؟</h3>
            <p style={{margin:0,color:C.textMuted,fontSize:14}}>هذا الإجراء لا يمكن التراجع عنه</p>
            <div style={{display:"flex",gap:10,justifyContent:"center"}}>
              <button style={{border:0,background:C.red,color:"#fff",borderRadius:10,padding:"10px 24px",cursor:"pointer",fontWeight:800,fontFamily:"Cairo,inherit",fontSize:14}} onClick={()=>delOrder(deleteConfirm)}>نعم، احذف</button>
              <button style={{border:`1px solid ${C.border}`,background:"transparent",color:C.textMuted,borderRadius:10,padding:"10px 24px",cursor:"pointer",fontWeight:700,fontFamily:"Cairo,inherit",fontSize:14}} onClick={()=>setDeleteConfirm(null)}>إلغاء</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Inp({label,value,onChange,type="text",C}) {
  const inp={border:`1px solid ${C.border}`,borderRadius:10,padding:"10px 12px",fontSize:14,outline:"none",background:C.surface2,color:C.text,fontFamily:"Cairo,inherit",minWidth:0,width:"100%",boxSizing:"border-box"};
  return <label style={{display:"grid",gap:6,fontWeight:800,color:C.textMuted,fontSize:13}}>{label}<input style={inp} type={type} value={value} onChange={e=>onChange(e.target.value)}/></label>;
}

function OrderCard({order,C,updateStatus,delOrder,startEdit}) {
  const waLink=makeWALink(order.customer?.phone||"",buildWAMsg(order));
  const total=Number(order.price||0)+DELIVERY_FEE;
  const ss=STATUS_STYLE[order.status]||{bg:"#1a1a1a",color:"#aaa",dot:"#888"};
  const overdue=isOverdue(order);

  return (
    <div style={{background:C.surface,border:overdue?`1px solid #f87171`:`1px solid ${C.border}`,borderRadius:14,padding:18,position:"relative"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
        <span style={{fontSize:12,color:C.textMuted,fontWeight:700}}>{order.id}</span>
        <div style={{display:"flex",gap:6,alignItems:"center"}}>
          {overdue && <span style={{background:"#250a0a",color:"#f87171",borderRadius:999,padding:"4px 10px",fontSize:11,fontWeight:800,border:"1px solid #f87171"}}>⚠️ متأخر {daysSince(order)} يوم</span>}
          <span style={{background:ss.bg,color:ss.color,borderRadius:999,padding:"4px 12px",fontSize:11,fontWeight:800}}>{order.status}</span>
        </div>
      </div>

      <p style={{fontSize:16,fontWeight:800,color:C.text,margin:"0 0 10px"}}>{order.items?.map(i=>i.product).join(" + ")}</p>

      {order.items?.map((item,idx)=>{
        const entries=getItemEntries(item);
        return (
          <div key={idx} style={{background:C.surface2,border:`1px solid ${C.border}`,borderRadius:10,padding:"10px 12px",marginBottom:8}}>
            <p style={{fontSize:12,color:C.textMuted,fontWeight:700,margin:"0 0 6px"}}>{idx+1}. {item.product}</p>
            {entries.map((e,ei)=>(
              <div key={ei} style={{display:"flex",alignItems:"center",gap:8,fontSize:13,padding:"5px 0",borderBottom:ei<entries.length-1?`1px solid ${C.border}`:"none"}}>
                <span style={{width:11,height:11,borderRadius:"50%",background:e.colorCode||"#888",border:`1px solid ${C.border2}`,flexShrink:0,display:"inline-block"}}/>
                <span style={{flex:1,fontWeight:700,color:C.text}}>{e.name||"بدون اسم"}</span>
                <span style={{color:C.textMuted,fontSize:12}}>العدد: {e.qty} · {e.colorName}</span>
              </div>
            ))}
            {item.notes && <p style={{fontSize:12,color:C.textDim,margin:"6px 0 0"}}>{item.notes}</p>}
            {item.image && <img src={item.image} alt="صورة" style={{width:"100%",maxHeight:180,objectFit:"cover",borderRadius:8,marginTop:8,border:`1px solid ${C.border}`}}/>}
          </div>
        );
      })}

      <hr style={{border:"none",borderTop:`1px solid ${C.border}`,margin:"12px 0"}}/>

      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:12}}>
        {[["الزبون",`${order.customer?.name||""} · ${fmtPhone(order.customer?.phone||"")}`],["العنوان",`${order.customer?.city||""} / ${order.customer?.address||""}`],["تاريخ الطلب",fmtDate(order.createdAtISO||order.createdAt)],["التتبع",order.tracking||"لا يوجد"]].map(([l,v])=>(
          <div key={l}>
            <div style={{fontSize:11,color:C.textDim,marginBottom:2}}>{l}</div>
            <div style={{fontSize:13,fontWeight:700,color:C.text}}>{v}</div>
          </div>
        ))}
      </div>

      <div style={{display:"flex",background:C.surface2,borderRadius:10,border:`1px solid ${C.border}`,marginBottom:12,flexWrap:"wrap",overflow:"hidden"}}>
        {[["السعر",fmt(order.price),C.text],["العربون",fmt(order.deposit),C.text],["المتبقي",fmt(Number(order.price)-Number(order.deposit)),"#60a5fa"],["التوصيل",fmt(DELIVERY_FEE),C.text],["السعر الكلي",fmt(total),C.green]].map(([l,v,c],i,arr)=>(
          <div key={l} style={{padding:"10px 12px",flex:1,minWidth:65,borderLeft:i<arr.length-1?`1px solid ${C.border}`:"none"}}>
            <div style={{fontSize:10,color:C.textDim,marginBottom:3}}>{l}</div>
            <div style={{fontSize:l==="السعر الكلي"?14:13,fontWeight:l==="السعر الكلي"?900:700,color:c}}>{v}</div>
          </div>
        ))}
      </div>

      <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:10}}>
        <a href={waLink} target="_blank" rel="noreferrer" style={{background:C.greenBg,border:`1px solid ${C.green}`,color:C.green,borderRadius:8,padding:"7px 12px",textDecoration:"none",fontSize:12,fontWeight:800}}>📱 واتساب</a>
        <button style={{background:C.surface2,border:`1px solid ${C.border}`,color:C.textMuted,borderRadius:8,padding:"7px 12px",fontSize:12,fontWeight:800,cursor:"pointer",fontFamily:"Cairo,inherit"}} onClick={()=>downloadPDF(invoiceHtml(order),`invoice-${order.id}.pdf`)}>🧾 فاتورة</button>
        <button style={{background:C.accentBg,border:`1px solid ${C.accent}`,color:C.accent,borderRadius:8,padding:"7px 12px",fontSize:12,fontWeight:800,cursor:"pointer",fontFamily:"Cairo,inherit"}} onClick={()=>startEdit(order)}>✏️ تعديل</button>
        <button style={{background:C.redBg,border:`1px solid ${C.red}`,color:C.red,borderRadius:8,padding:"7px 12px",fontSize:12,fontWeight:800,cursor:"pointer",fontFamily:"Cairo,inherit"}} onClick={()=>delOrder(order.id)}>🗑 حذف</button>
      </div>

      <div style={{display:"flex",gap:6,flexWrap:"wrap",paddingTop:10,borderTop:`1px solid ${C.border}`}}>
        {statuses.map(st=>{
          const active=order.status===st;
          const ss2=STATUS_STYLE[st]||{};
          return <button key={st} style={{border:active?`1px solid ${ss2.dot||C.accent}`:`1px solid ${C.border}`,background:active?(ss2.bg||C.accentBg):"transparent",color:active?(ss2.color||C.accent):C.textMuted,borderRadius:999,padding:"4px 10px",fontSize:11,cursor:"pointer",fontWeight:700,fontFamily:"Cairo,inherit"}} onClick={()=>updateStatus(order.id,st)}>{st}</button>;
        })}
      </div>
    </div>
  );
}
