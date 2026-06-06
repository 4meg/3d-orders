import React, { useEffect, useMemo, useState } from "react";
import html2pdf from "html2pdf.js/dist/html2pdf.bundle.min.js";
import { db } from "./firebase";
import { collection, addDoc, getDocs, doc, updateDoc, deleteDoc } from "firebase/firestore";

const DISCORD_WEBHOOK_URL = import.meta.env.VITE_DISCORD_WEBHOOK_URL || "";
const DELIVERY_COMPANY = "الوسيط";
const DELIVERY_FEE = 5000;
const DEFAULT_STATUS = "تحت التصميم";

const provinces = ["بغداد","البصرة","نينوى","أربيل","النجف","كربلاء","السليمانية","دهوك","كركوك","ديالى","الأنبار","بابل","واسط","صلاح الدين","الديوانية","ذي قار","ميسان","المثنى"];
const defaultColors = [{name:"أسود",code:"#111827"},{name:"أبيض",code:"#ffffff"},{name:"أحمر",code:"#dc2626"},{name:"أزرق",code:"#2563eb"},{name:"أخضر",code:"#16a34a"}];
const defaultProducts = ["حافظة كيبل","ميدالية","مجسم 3D","ستاند","شعار","قطعة خاصة"];
const statuses = ["تحت التصميم","تحت الطباعة","جاهز","قيد التوصيل","مكتمل","ملغي"];

const STATUS_STYLE = {
  "تحت التصميم": { bg:"#0c2040", color:"#60a5fa", dot:"#3b82f6" },
  "تحت الطباعة": { bg:"#2a1d00", color:"#fbbf24", dot:"#f59e0b" },
  "جاهز":        { bg:"#0a2015", color:"#34d399", dot:"#10b981" },
  "قيد التوصيل": { bg:"#1e0f35", color:"#c084fc", dot:"#a855f7" },
  "مكتمل":       { bg:"#052020", color:"#2dd4bf", dot:"#14b8a6" },
  "ملغي":        { bg:"#250a0a", color:"#f87171", dot:"#ef4444" },
};

const D = {
  bg:"#0d1117", surface:"#161b22", surface2:"#21262d",
  border:"#30363d", border2:"#3d4451",
  text:"#e6edf3", textMuted:"#8b949e", textDim:"#484f58",
  accent:"#58a6ff", accentBg:"#0c2d6b",
  green:"#3fb950", greenBg:"#0d2818",
  red:"#f85149", redBg:"#250a0a",
};

function loadData(key, fallback) {
  try {
    const s = localStorage.getItem(key);
    if (s) { const p = JSON.parse(s); if (Array.isArray(p) && p.length > 0) return p; }
  } catch {}
  return fallback;
}
function saveData(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch {} }

async function sendDiscord(msg) {
  if (!DISCORD_WEBHOOK_URL) return;
  try { await fetch(DISCORD_WEBHOOK_URL, { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({content:msg}) }); } catch {}
}

function normalizePhone(p) { return String(p||"").replace(/\D/g,"").trim(); }
function getIraqWA(phone) {
  let d = normalizePhone(phone);
  if (d.startsWith("00964")) d = d.slice(2);
  if (d.startsWith("964")) return d;
  if (d.startsWith("0")) return `964${d.slice(1)}`;
  return `964${d}`;
}
function makeWALink(phone, msg) { return `https://wa.me/${getIraqWA(phone)}?text=${encodeURIComponent(msg)}`; }
function emptyEntry(colors) { const c=colors[0]||{name:"",code:"#000"}; return {name:"",qty:1,colorName:c.name,colorCode:c.code}; }
function emptyItem(colors, products) { return {product:products[0]||"حافظة كيبل",entries:[emptyEntry(colors)],notes:"",image:null}; }
function getItemEntries(item) {
  if (item.entries) return item.entries;
  if (item.names) return item.names.map(n=>({name:n,qty:item.qty||1,colorName:item.colorName||"",colorCode:item.colorCode||"#000"}));
  return [];
}
function parseOrderDate(o) { const d=new Date(o.createdAtISO||o.createdAt); return isNaN(d)?new Date():d; }
function fmt(v) { return `${Number(v||0).toLocaleString()} د.ع`; }
function fmtDate(s) {
  return new Date(s).toLocaleString("en-GB",{timeZone:"Asia/Baghdad",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hour12:true});
}
function fmtPhone(phone) {
  const ar="٠١٢٣٤٥٦٧٨٩";
  let d=String(phone).split("").map(c=>{const i=ar.indexOf(c);return i>-1?i:c;}).join("");
  d=normalizePhone(d);
  return d.length===11?`${d.slice(0,4)} ${d.slice(4,7)} ${d.slice(7)}`:d;
}

function buildWAMsg(order) {
  const items = order.items.map((item,i)=>{
    const lines = getItemEntries(item).map(e=>`- ${e.name||"بدون اسم"} | العدد: ${e.qty}`).join("\n");
    return `${i+1}) ${item.product}\n${lines}`;
  }).join("\n\n");
  return `السلام عليكم ورحمة الله وبركاته\nعندكم طلب من الطباعة ثلاثية الأبعاد من متجر نايت ستور.\n\nhttps://www.instagram.com/night_99q\n\nاسم الزبون: ${order.customer.name}\nرقم الهاتف: 964${order.customer.phone.replace(/^0/,"")}\nرقم الطلب: ${order.id}\n\nتفاصيل الطلب:\n${items}\n\nمبلغ الطلب: ${fmt(order.price)}\nأجور التوصيل: ${fmt(DELIVERY_FEE)}\n\nشكراً لاختياركم نايت ستور.`;
}

function invoiceHtml(order) {
  const rows = order.items.map((item,i)=>{
    const entries = getItemEntries(item).map(e=>`<div>${e.name||"بدون اسم"} - العدد: ${e.qty}</div>`).join("");
    const img = item.image?`<img src="${item.image}" style="width:70px;height:70px;object-fit:cover;border-radius:8px;border:1px solid #cbd5e1;margin-top:6px;"/>`:"";
    return `<tr><td style="border:1px solid #cbd5e1;padding:10px;">${i+1}</td><td style="border:1px solid #cbd5e1;padding:10px;">${item.product}</td><td style="border:1px solid #cbd5e1;padding:10px;">${entries}${img}</td></tr>`;
  }).join("");
  const total = Number(order.price||0)+DELIVERY_FEE;
  return `<div dir="rtl" style="font-family:Tahoma,Arial,sans-serif;padding:28px;color:#111827;background:#fff;width:760px;box-sizing:border-box;"><div style="border-bottom:2px solid #111827;padding-bottom:14px;margin-bottom:18px;"><h1 style="margin:0;font-size:28px;">فاتورة طلب</h1><p style="margin:6px 0 0;font-size:16px;">متجر نايت ستور - الطباعة ثلاثية الأبعاد</p><p style="margin:6px 0 0;"><b>رقم الطلب:</b> ${order.id}</p></div><div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:16px;font-size:15px;"><div><b>اسم الزبون:</b> ${order.customer.name||""}</div><div><b>رقم الهاتف:</b> ${order.customer.phone||""}</div><div><b>المحافظة:</b> ${order.customer.city||""}</div><div><b>العنوان:</b> ${order.customer.address||"غير محدد"}</div></div><table style="width:100%;border-collapse:collapse;margin:14px 0;font-size:15px;"><thead><tr style="background:#eff6ff;"><th style="border:1px solid #cbd5e1;padding:10px;">#</th><th style="border:1px solid #cbd5e1;padding:10px;">المنتج</th><th style="border:1px solid #cbd5e1;padding:10px;">التفاصيل</th></tr></thead><tbody>${rows}</tbody></table><div style="margin-top:18px;padding:16px;border:1px solid #cbd5e1;border-radius:12px;background:#f8fafc;font-size:17px;line-height:2;"><div><b>مبلغ الطلب:</b> ${fmt(order.price)}</div><div><b>العربون:</b> ${fmt(order.deposit)}</div><div><b>المتبقي:</b> ${fmt(Number(order.price||0)-Number(order.deposit||0))}</div><div><b>أجور التوصيل:</b> ${fmt(DELIVERY_FEE)}</div><div><b>شركة التوصيل:</b> ${DELIVERY_COMPANY}</div><div style="border-top:1px solid #cbd5e1;margin-top:8px;padding-top:8px;color:#0f6e56;"><b>السعر الكلي (مع التوصيل):</b> ${fmt(total)}</div></div><p style="margin-top:20px;text-align:center;font-weight:bold;">شكراً لاختياركم متجر نايت ستور</p></div>`;
}

function downloadPDF(html, filename) {
  const h=document.createElement("div"); h.style.cssText="position:fixed;left:-10000px;top:0;"; h.innerHTML=html; document.body.appendChild(h);
  html2pdf().set({margin:8,filename,image:{type:"jpeg",quality:0.98},html2canvas:{scale:2,useCORS:true},jsPDF:{unit:"mm",format:"a4",orientation:"portrait"}}).from(h.firstElementChild||h).save().finally(()=>h.remove());
}

const s = {
  app:      {minHeight:"100vh",background:D.bg,padding:"20px 24px",fontFamily:"Cairo,Tahoma,Arial,sans-serif",color:D.text,direction:"rtl"},
  topbar:   {background:D.surface,borderRadius:16,padding:"18px 24px",display:"flex",justifyContent:"space-between",gap:16,flexWrap:"wrap",alignItems:"center",border:`1px solid ${D.border}`,marginBottom:20},
  navBtn:   {border:`1px solid ${D.border}`,background:"transparent",color:D.textMuted,borderRadius:8,padding:"8px 14px",cursor:"pointer",fontWeight:700,fontFamily:"Cairo,inherit",fontSize:13},
  navActive:{border:`1px solid ${D.accent}`,background:D.accentBg,color:D.accent,borderRadius:8,padding:"8px 14px",cursor:"pointer",fontWeight:700,fontFamily:"Cairo,inherit",fontSize:13},
  addBtn:   {border:0,background:D.accent,color:"#0d1117",borderRadius:8,padding:"8px 16px",cursor:"pointer",fontWeight:800,fontFamily:"Cairo,inherit",fontSize:13},
  delBtn:   {border:`1px solid ${D.redBg}`,background:D.redBg,color:D.red,borderRadius:8,padding:"8px 14px",cursor:"pointer",fontWeight:700,fontFamily:"Cairo,inherit",fontSize:13},
  statsGrid:{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(140px,1fr))",gap:12,marginBottom:20},
  statCard: {background:D.surface,border:`1px solid ${D.border}`,borderRadius:12,padding:"14px 16px"},
  search:   {width:"100%",boxSizing:"border-box",marginBottom:14,border:`1px solid ${D.border}`,borderRadius:10,padding:"12px 16px",fontSize:14,outline:"none",background:D.surface,color:D.text,fontFamily:"Cairo,inherit"},
  filterRow:{display:"flex",gap:8,flexWrap:"wrap",marginBottom:20},
  fBtn:     {border:`1px solid ${D.border}`,background:"transparent",color:D.textMuted,borderRadius:999,padding:"6px 14px",cursor:"pointer",fontWeight:700,fontFamily:"Cairo,inherit",fontSize:12},
  fActive:  {border:`1px solid ${D.accent}`,background:D.accentBg,color:D.accent,borderRadius:999,padding:"6px 14px",cursor:"pointer",fontWeight:700,fontFamily:"Cairo,inherit",fontSize:12},
  grid:     {display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(330px,1fr))",gap:16},
  card:     {background:D.surface,border:`1px solid ${D.border}`,borderRadius:14,padding:18},
  form:     {maxWidth:920,margin:"0 auto",background:D.surface,border:`1px solid ${D.border}`,borderRadius:16,padding:24,display:"grid",gap:14},
  label:    {display:"grid",gap:6,fontWeight:800,color:D.textMuted,fontSize:13},
  input:    {border:`1px solid ${D.border}`,borderRadius:10,padding:"10px 12px",fontSize:14,outline:"none",background:D.surface2,color:D.text,fontFamily:"Cairo,inherit",minWidth:0},
  secTitle: {margin:"10px 0 0",color:D.accent,borderBottom:`1px solid ${D.border}`,paddingBottom:8,fontWeight:800,fontSize:15},
  saveBtn:  {border:0,background:D.green,color:"#0d1117",borderRadius:10,padding:14,fontSize:16,cursor:"pointer",fontWeight:900,fontFamily:"Cairo,inherit"},
  itemBox:  {display:"grid",gap:12,background:D.surface2,border:`1px solid ${D.border}`,borderRadius:14,padding:16},
  eRow:     {display:"grid",gridTemplateColumns:"1.5fr 80px 1fr 140px auto",gap:8,alignItems:"center"},
  smBlue:   {border:0,background:D.accentBg,color:D.accent,borderRadius:8,padding:"8px 12px",cursor:"pointer",fontWeight:800,fontFamily:"Cairo,inherit",fontSize:12},
  smRed:    {border:0,background:D.redBg,color:D.red,borderRadius:8,padding:"8px 10px",cursor:"pointer",fontWeight:800,fontFamily:"Cairo,inherit",fontSize:12},
  addItem:  {border:`1px dashed ${D.accent}`,background:D.accentBg,color:D.accent,borderRadius:12,padding:12,cursor:"pointer",fontWeight:900,fontFamily:"Cairo,inherit",fontSize:14},
  colorPkr: {height:42,width:60,border:`1px solid ${D.border}`,borderRadius:10,background:D.surface2,padding:4,cursor:"pointer"},
  chip:     {display:"inline-flex",alignItems:"center",gap:8,background:D.surface2,color:D.text,border:`1px solid ${D.border}`,borderRadius:999,padding:"7px 12px",fontWeight:800,fontSize:13},
  xBtn:     {marginRight:6,border:0,background:D.redBg,color:D.red,borderRadius:999,cursor:"pointer",fontWeight:900,padding:"2px 7px",fontFamily:"inherit"},
  delBox:   {border:`1px solid ${D.border}`,background:D.surface2,borderRadius:10,padding:"10px 12px",display:"flex",gap:8,alignItems:"center",fontWeight:800,fontSize:13,color:D.text},
  delivBox: {background:D.accentBg,color:D.accent,border:`1px solid #1d3f7a`,padding:12,borderRadius:10,fontSize:13},
  imgBox:   {display:"grid",gap:10,background:D.surface,border:`1px dashed ${D.border2}`,borderRadius:12,padding:12},
};

export default function App() {
  const [authorized, setAuthorized] = useState(localStorage.getItem("site_auth")==="yes");
  const [password, setPassword] = useState("");

  if (!authorized) {
    return (
      <div style={{minHeight:"100vh",background:D.bg,display:"flex",flexDirection:"column",justifyContent:"center",alignItems:"center",gap:16,fontFamily:"Cairo,sans-serif",color:D.text}}>
        <h2 style={{margin:0,fontSize:22}}>ادخل رمز الدخول</h2>
        <input type="password" value={password} onChange={e=>setPassword(e.target.value)}
          style={{background:D.surface2,border:`1px solid ${D.border}`,borderRadius:10,padding:"10px 16px",color:D.text,fontSize:16,outline:"none",fontFamily:"Cairo,inherit",width:220}}/>
        <button onClick={()=>{if(password==="333"){localStorage.setItem("site_auth","yes");setAuthorized(true);}else alert("رمز غير صحيح");}}
          style={{background:D.accent,color:"#0d1117",border:0,borderRadius:10,padding:"10px 28px",fontSize:15,fontWeight:900,cursor:"pointer",fontFamily:"Cairo,inherit"}}>دخول</button>
      </div>
    );
  }

  const [page, setPage] = useState("orders");
  const [orders, setOrders] = useState([]);
  // ✅ إصلاح: تحميل وحفظ الألوان والمنتجات بشكل صحيح
  const [colors, setColors] = useState(()=>loadData("ns_colors_v1", defaultColors));
  const [products, setProducts] = useState(()=>loadData("ns_products_v1", defaultProducts));
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("الكل");
  const [newColor, setNewColor] = useState({name:"",code:"#000000"});
  const [newProduct, setNewProduct] = useState("");
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState({customerName:"",phone:"",city:"بغداد",address:"",items:[emptyItem(defaultColors,defaultProducts)],price:"",deposit:"",tracking:"",notes:""});

  // ✅ حفظ فوري عند كل تغيير
  useEffect(()=>{ saveData("ns_colors_v1", colors); }, [colors]);
  useEffect(()=>{ saveData("ns_products_v1", products); }, [products]);

  // ✅ إصلاح الفلتر: trim الحالة عند الجلب
  useEffect(()=>{
    async function fetch_() {
      const snap = await getDocs(collection(db,"orders"));
      setOrders(snap.docs.map(d=>({firebaseId:d.id,...d.data(),status:String(d.data().status||DEFAULT_STATUS).trim()})));
    }
    fetch_();
  },[]);

  const customers = useMemo(()=>{
    const map = new Map();
    orders.forEach(o=>{
      const k = normalizePhone(o.customer.phone||o.customer.name);
      const old = map.get(k);
      map.set(k,{...o.customer,total:(old?.total||0)+Number(o.price||0),count:(old?.count||0)+1});
    });
    return Array.from(map.values());
  },[orders]);

  // ✅ إصلاح الفلتر: مقارنة صحيحة
  const filteredOrders = useMemo(()=>{
    const q = search.trim();
    return [...orders]
      .sort((a,b)=>Number(a.id?.replace("O-","")||0)-Number(b.id?.replace("O-","")||0))
      .filter(o=>{
        const txt = `${o.id} ${o.status} ${o.customer.name} ${o.customer.phone} ${o.customer.city} ${o.items.map(i=>`${i.product} ${getItemEntries(i).map(e=>`${e.name} ${e.colorName}`).join(" ")}`).join(" ")}`;
        return (!q||txt.includes(q)) && (statusFilter==="الكل" || String(o.status).trim()===String(statusFilter).trim());
      });
  },[orders,search,statusFilter]);

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
      count:done.length, wCount:wDone.length, mCount:mDone.length,
    };
  },[orders]);

  const updItem=(i,p)=>{ const items=[...form.items]; items[i]={...items[i],...p}; setForm({...form,items}); };
  const updEntry=(ii,ei,p)=>{ const item=form.items[ii]; const entries=[...item.entries]; entries[ei]={...entries[ei],...p}; updItem(ii,{entries}); };
  const resetForm=()=>{ setEditingId(null); setForm({customerName:"",phone:"",city:"بغداد",address:"",items:[emptyItem(colors,products)],price:"",deposit:"",tracking:"",notes:""}); };

  async function submitOrder() {
    if (!form.customerName||!form.phone||!form.items[0]?.product) return alert("اكتب اسم الزبون ورقم الهاتف وتفاصيل الطلب");
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
    if (editingId) {
      if (old?.firebaseId) await updateDoc(doc(db,"orders",old.firebaseId),saved);
      setOrders(orders.map(o=>o.id===editingId?{...saved,firebaseId:old?.firebaseId}:o));
      sendDiscord(`✏️ تعديل طلب\nرقم: ${saved.id}\nالزبون: ${saved.customer.name}`);
    } else {
      const ref=await addDoc(collection(db,"orders"),saved);
      setOrders([...orders,{...saved,firebaseId:ref.id}]);
      sendDiscord(`🧾 طلب جديد\nرقم: ${saved.id}\nالزبون: ${saved.customer.name}\nالهاتف: ${saved.customer.phone}\nالسعر الكلي: ${(saved.price+DELIVERY_FEE).toLocaleString()} د.ع`);
    }
    resetForm(); setPage("orders");
  }

  function startEdit(order) {
    setEditingId(order.id);
    setForm({
      customerName:order.customer.name||"",phone:order.customer.phone||"",city:order.customer.city||"بغداد",address:order.customer.address||"",
      items:order.items.map(item=>({product:item.product,notes:item.notes||"",image:item.image||null,entries:getItemEntries(item).map(e=>({name:e.name||"",qty:e.qty||1,colorName:e.colorName||colors[0]?.name||"",colorCode:e.colorCode||colors[0]?.code||"#000"}))})),
      price:String(order.price||""),deposit:String(order.deposit||""),tracking:order.tracking||"",notes:order.notes||"",
    });
    setPage("newOrder");
  }

  async function updateStatus(id, status) {
    const o=orders.find(x=>x.id===id);
    if (o?.firebaseId) await updateDoc(doc(db,"orders",o.firebaseId),{status});
    setOrders(orders.map(x=>x.id===id?{...x,status}:x));
    sendDiscord(`🔄 تحديث حالة\nرقم: ${id}\nالزبون: ${o?.customer.name||""}\nالحالة: ${status}`);
  }

  async function delOrder(id) {
    if (!confirm("متأكد تريد حذف الطلب؟")) return;
    const o=orders.find(x=>x.id===id);
    if (o?.firebaseId) await deleteDoc(doc(db,"orders",o.firebaseId));
    setOrders(orders.filter(x=>x.id!==id));
  }

  function addColor() {
    const name=newColor.name.trim(); if (!name) return;
    if (colors.some(c=>c.name===name)) return alert("هذا اللون موجود");
    setColors([...colors,{name,code:newColor.code}]);
    setNewColor({name:"",code:"#000000"});
  }

  function addProduct() {
    const p=newProduct.trim(); if (!p) return;
    if (products.includes(p)) return alert("هذا المنتج موجود");
    setProducts([...products,p]); setNewProduct("");
  }

  function exportPDF() {
    const rows=filteredCustomers.map((c,i)=>`<tr><td style="border:1px solid #cbd5e1;padding:10px;">${i+1}</td><td style="border:1px solid #cbd5e1;padding:10px;">${c.name||""}</td><td style="border:1px solid #cbd5e1;padding:10px;">${c.phone||""}</td><td style="border:1px solid #cbd5e1;padding:10px;">${c.city||""}</td><td style="border:1px solid #cbd5e1;padding:10px;">${c.address||""}</td><td style="border:1px solid #cbd5e1;padding:10px;">${c.count||0}</td><td style="border:1px solid #cbd5e1;padding:10px;">${fmt(c.total)}</td></tr>`).join("");
    downloadPDF(`<div dir="rtl" style="font-family:Tahoma;padding:28px;color:#111827;background:#fff;width:900px;"><h1>تقرير الزبائن - متجر نايت ستور</h1><p>تاريخ التصدير: ${new Date().toLocaleString("ar-IQ")}</p><table style="width:100%;border-collapse:collapse;font-size:14px;"><thead><tr style="background:#eff6ff;"><th style="border:1px solid #cbd5e1;padding:10px;">#</th><th style="border:1px solid #cbd5e1;padding:10px;">الاسم</th><th style="border:1px solid #cbd5e1;padding:10px;">الهاتف</th><th style="border:1px solid #cbd5e1;padding:10px;">المحافظة</th><th style="border:1px solid #cbd5e1;padding:10px;">العنوان</th><th style="border:1px solid #cbd5e1;padding:10px;">الطلبات</th><th style="border:1px solid #cbd5e1;padding:10px;">الإجمالي</th></tr></thead><tbody>${rows}</tbody></table></div>`,"customers.pdf");
  }

  return (
    <div style={s.app}>
      <header style={s.topbar}>
        <div>
          <h1 style={{margin:0,fontSize:24,color:D.text,fontWeight:900}}>🖨 نايت ستور 3D</h1>
          <p style={{margin:"4px 0 0",color:D.textMuted,fontSize:12}}>نظام إدارة الطلبات</p>
        </div>
        <div style={{display:"flex",gap:8,flexWrap:"wrap",alignItems:"center"}}>
          {[["orders","الطلبات"],["customers","الزبائن"],["colors","الألوان"],["products","المنتجات"],["reports","التقارير"]].map(([k,l])=>(
            <button key={k} style={page===k?s.navActive:s.navBtn} onClick={()=>setPage(k)}>{l}</button>
          ))}
          <button style={s.addBtn} onClick={()=>{resetForm();setPage("newOrder");}}>+ طلب جديد</button>
          <button style={s.delBtn} onClick={()=>{if(confirm("حذف كل البيانات؟")){setOrders([]);localStorage.removeItem("orders_v4");}}}>حذف الكل</button>
        </div>
      </header>

      <div style={s.statsGrid}>
        {[
          ["كل الطلبات",orders.length,D.accent],
          ["الزبائن",customers.length,"#c084fc"],
          ["تحت التصميم",orders.filter(o=>o.status==="تحت التصميم").length,"#60a5fa"],
          ["تحت الطباعة",orders.filter(o=>o.status==="تحت الطباعة").length,"#fbbf24"],
          ["قيد التوصيل",orders.filter(o=>o.status==="قيد التوصيل").length,"#a78bfa"],
          ["مكتملة الأسبوع",fmt(stats.wTotal),D.green],
          ["مكتملة الشهر",fmt(stats.mTotal),"#34d399"],
        ].map(([label,val,color])=>(
          <div key={label} style={s.statCard}>
            <div style={{fontSize:12,color:D.textMuted,marginBottom:6}}>{label}</div>
            <div style={{fontSize:22,fontWeight:900,color}}>{val}</div>
          </div>
        ))}
      </div>

      <input style={s.search} placeholder="بحث باسم الزبون أو الرقم أو الطلب أو اللون..." value={search} onChange={e=>setSearch(e.target.value)}/>

      <div style={s.filterRow}>
        {["الكل",...statuses].map(st=>(
          <button key={st} style={statusFilter===st?s.fActive:s.fBtn} onClick={()=>setStatusFilter(st)}>{st}</button>
        ))}
      </div>

      {page==="orders" && (
        <div style={s.grid}>
          {filteredOrders.map(o=><OrderCard key={o.id} order={o} updateStatus={updateStatus} delOrder={delOrder} startEdit={startEdit} colors={colors}/>)}
          {filteredOrders.length===0 && <div style={{color:D.textMuted,padding:40,textAlign:"center",gridColumn:"1/-1"}}>لا توجد طلبات</div>}
        </div>
      )}

      {page==="customers" && (
        <>
          <button style={{...s.addBtn,marginBottom:14}} onClick={exportPDF}>تحميل PDF</button>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(270px,1fr))",gap:14}}>
            {filteredCustomers.map(c=>(
              <div key={c.phone} style={s.card}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
                  <b style={{color:D.text,fontSize:15}}>{c.name}</b>
                  <a style={{background:"#0d2a1a",border:"1px solid #1a5c34",color:"#4ade80",borderRadius:8,padding:"6px 10px",textDecoration:"none",fontSize:12,fontWeight:800}} href={makeWALink(c.phone,`مرحبا ${c.name}`)} target="_blank" rel="noreferrer">واتساب</a>
                </div>
                {[["الهاتف",c.phone],["العنوان",`${c.city} / ${c.address}`],["الطلبات",c.count]].map(([l,v])=>(
                  <p key={l} style={{color:D.textMuted,fontSize:13,margin:"4px 0"}}><span style={{color:D.textDim}}>{l}: </span>{v}</p>
                ))}
                <p style={{color:D.green,fontSize:14,fontWeight:800,margin:"8px 0 0"}}>{c.total.toLocaleString()} د.ع</p>
              </div>
            ))}
          </div>
        </>
      )}

      {page==="colors" && (
        <div style={s.form}>
          <h2 style={{margin:0,color:D.text,fontWeight:900,fontSize:20}}>مخزن الألوان</h2>
          <div style={{display:"grid",gridTemplateColumns:"1fr auto auto",gap:10,alignItems:"center"}}>
            <input style={s.input} value={newColor.name} onChange={e=>setNewColor({...newColor,name:e.target.value})} placeholder="اسم اللون"/>
            <input type="color" style={s.colorPkr} value={newColor.code} onChange={e=>setNewColor({...newColor,code:e.target.value})}/>
            <button style={s.addBtn} onClick={addColor}>إضافة</button>
          </div>
          <div style={{display:"flex",flexWrap:"wrap",gap:10,marginTop:10}}>
            {colors.map(c=>(
              <span key={c.name} style={s.chip}>
                <span style={{width:14,height:14,borderRadius:"50%",background:c.code,border:`1px solid ${D.border2}`,display:"inline-block"}}/>
                {c.name}
                <button style={s.xBtn} onClick={()=>setColors(colors.filter(x=>x.name!==c.name))}>×</button>
              </span>
            ))}
          </div>
        </div>
      )}

      {page==="products" && (
        <div style={s.form}>
          <h2 style={{margin:0,color:D.text,fontWeight:900,fontSize:20}}>المنتجات</h2>
          <div style={{display:"grid",gridTemplateColumns:"1fr auto",gap:10,alignItems:"center"}}>
            <input style={s.input} value={newProduct} onChange={e=>setNewProduct(e.target.value)} placeholder="اسم المنتج"/>
            <button style={s.addBtn} onClick={addProduct}>إضافة</button>
          </div>
          <div style={{display:"flex",flexWrap:"wrap",gap:10,marginTop:10}}>
            {products.map(p=>(
              <span key={p} style={s.chip}>{p}<button style={s.xBtn} onClick={()=>setProducts(products.filter(x=>x!==p))}>×</button></span>
            ))}
          </div>
        </div>
      )}

      {page==="reports" && (
        <div style={s.form}>
          <h2 style={{margin:0,color:D.text,fontWeight:900,fontSize:20}}>التقارير</h2>
          <div style={s.statsGrid}>
            {[["المكتملة",stats.count,D.green],["إجمالي المكتملة",fmt(stats.total),D.green],["أسبوعية",`${stats.wCount} طلب`,D.accent],["مبالغ الأسبوع",fmt(stats.wTotal),D.accent],["شهرية",`${stats.mCount} طلب`,"#c084fc"],["مبالغ الشهر",fmt(stats.mTotal),"#c084fc"]].map(([l,v,c])=>(
              <div key={l} style={s.statCard}><div style={{fontSize:12,color:D.textMuted,marginBottom:6}}>{l}</div><div style={{fontSize:18,fontWeight:900,color:c}}>{v}</div></div>
            ))}
          </div>
          <button style={{...s.addBtn,width:"fit-content"}} onClick={exportPDF}>تحميل قائمة الزبائن PDF</button>
          <div style={{overflowX:"auto",background:D.surface2,borderRadius:12,border:`1px solid ${D.border}`}}>
            <table style={{width:"100%",borderCollapse:"collapse",minWidth:600,fontSize:13}}>
              <thead><tr style={{background:D.surface}}>
                {["الاسم","الهاتف","المحافظة","العنوان","الطلبات","الإجمالي"].map(h=>(
                  <th key={h} style={{padding:"10px 12px",textAlign:"right",color:D.textMuted,borderBottom:`1px solid ${D.border}`,fontWeight:700}}>{h}</th>
                ))}
              </tr></thead>
              <tbody>{filteredCustomers.map(c=>(
                <tr key={c.phone} style={{borderBottom:`1px solid ${D.border}`}}>
                  {[c.name,c.phone,c.city,c.address,c.count,fmt(c.total)].map((v,i)=>(
                    <td key={i} style={{padding:"9px 12px",color:i===5?D.green:D.text}}>{v}</td>
                  ))}
                </tr>
              ))}</tbody>
            </table>
          </div>
        </div>
      )}

      {page==="newOrder" && (
        <div style={s.form}>
          <h2 style={{margin:0,color:D.text,fontWeight:900,fontSize:20}}>{editingId?`تعديل الطلب ${editingId}`:"إضافة طلب جديد"}</h2>
          <h3 style={s.secTitle}>معلومات الزبون</h3>
          <F label="اسم الزبون" value={form.customerName} onChange={v=>setForm({...form,customerName:v})}/>
          <F label="رقم الهاتف" value={form.phone} onChange={v=>setForm({...form,phone:v})}/>
          <label style={s.label}>المحافظة
            <input style={s.input} list="plist" value={form.city} onChange={e=>setForm({...form,city:e.target.value})}/>
            <datalist id="plist">{provinces.map(p=><option key={p} value={p}/>)}</datalist>
          </label>
          <F label="العنوان التفصيلي" value={form.address} onChange={v=>setForm({...form,address:v})}/>

          <h3 style={s.secTitle}>تفاصيل المنتجات</h3>
          {form.items.map((item,idx)=>(
            <div key={idx} style={s.itemBox}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                <b style={{color:D.text,fontSize:14}}>منتج رقم {idx+1}</b>
                {form.items.length>1 && <button style={s.smRed} onClick={()=>setForm({...form,items:form.items.filter((_,i)=>i!==idx)})}>حذف المنتج</button>}
              </div>
              <label style={s.label}>المنتج
                <select style={s.input} value={item.product} onChange={e=>updItem(idx,{product:e.target.value})}>
                  {products.map(p=><option key={p} value={p}>{p}</option>)}
                </select>
              </label>
              {item.product==="قطعة خاصة" && (
                <div style={s.imgBox}>
                  <label style={s.label}>صورة القطعة الخاصة</label>
                  <input style={s.input} type="file" accept="image/*" onChange={e=>{
                    const file=e.target.files[0]; if(!file) return;
                    const reader=new FileReader(); const canvas=document.createElement("canvas"); const img=new Image();
                    reader.onload=()=>{img.src=reader.result;};
                    img.onload=()=>{const MAX=600;let w=img.width,h=img.height;if(w>MAX){h*=MAX/w;w=MAX;}canvas.width=w;canvas.height=h;canvas.getContext("2d").drawImage(img,0,0,w,h);updItem(idx,{image:canvas.toDataURL("image/jpeg",0.7)});};
                    reader.readAsDataURL(file);
                  }}/>
                  {item.image && <img src={item.image} alt="صورة" style={{width:150,maxHeight:150,objectFit:"cover",borderRadius:10,border:`1px solid ${D.border}`}}/>}
                </div>
              )}
              <div style={{display:"grid",gap:8}}>
                <b style={{color:D.textMuted,fontSize:13}}>الأسماء — لكل اسم لون وعدد خاص</b>
                {item.entries.map((entry,ei)=>(
                  <div key={ei} style={s.eRow}>
                    <input style={s.input} value={entry.name} onChange={e=>updEntry(idx,ei,{name:e.target.value})} placeholder={`الاسم ${ei+1}`}/>
                    <input style={s.input} type="number" value={entry.qty} onChange={e=>updEntry(idx,ei,{qty:e.target.value})} placeholder="العدد"/>
                    <select style={s.input} value={entry.colorName} onChange={e=>{const c=colors.find(x=>x.name===e.target.value);updEntry(idx,ei,{colorName:c?.name||"",colorCode:c?.code||"#000"});}}>
                      {colors.map(c=><option key={c.name} value={c.name}>{c.name}</option>)}
                    </select>
                    <div style={s.delBox}>
                      <span style={{width:12,height:12,borderRadius:"50%",background:entry.colorCode,border:`1px solid ${D.border2}`,display:"inline-block"}}/>
                      {entry.colorName}
                    </div>
                    {item.entries.length>1 && <button style={s.smRed} onClick={()=>{const item2=form.items[idx];updItem(idx,{entries:item2.entries.filter((_,i)=>i!==ei)});}}>حذف</button>}
                  </div>
                ))}
                <button style={s.smBlue} onClick={()=>updItem(idx,{entries:[...item.entries,emptyEntry(colors)]})}>+ إضافة اسم</button>
              </div>
              <F label="ملاحظات المنتج" value={item.notes} onChange={v=>updItem(idx,{notes:v})}/>
            </div>
          ))}
          <button style={s.addItem} onClick={()=>setForm({...form,items:[...form.items,emptyItem(colors,products)]})}>+ إضافة منتج آخر</button>

          <h3 style={s.secTitle}>الدفع والتوصيل</h3>
          <F label="السعر" type="number" value={form.price} onChange={v=>setForm({...form,price:v})}/>
          <F label="العربون" type="number" value={form.deposit} onChange={v=>setForm({...form,deposit:v})}/>
          <F label="رقم تتبع الوسيط (اختياري)" value={form.tracking} onChange={v=>setForm({...form,tracking:v})}/>
          <F label="ملاحظات عامة" value={form.notes} onChange={v=>setForm({...form,notes:v})}/>
          <div style={s.delivBox}>شركة التوصيل: <b>{DELIVERY_COMPANY}</b> — أجرة التوصيل: <b>{DELIVERY_FEE.toLocaleString()} د.ع</b></div>
          <div style={{display:"flex",gap:10}}>
            <button style={s.saveBtn} onClick={submitOrder}>{editingId?"حفظ التعديل":"حفظ الطلب"}</button>
            {editingId && <button style={s.navBtn} onClick={resetForm}>إلغاء</button>}
          </div>
        </div>
      )}
    </div>
  );
}

function F({label,value,onChange,type="text"}) {
  return <label style={s.label}>{label}<input style={s.input} type={type} value={value} onChange={e=>onChange(e.target.value)}/></label>;
}

function OrderCard({order,updateStatus,delOrder,startEdit}) {
  const waLink = makeWALink(order.customer.phone, buildWAMsg(order));
  const total = Number(order.price||0)+DELIVERY_FEE;
  const ss = STATUS_STYLE[order.status]||{bg:"#1a1a1a",color:"#aaa",dot:"#888"};

  return (
    <div style={s.card}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
        <span style={{fontSize:12,color:D.textMuted,fontWeight:700}}>{order.id}</span>
        <span style={{background:ss.bg,color:ss.color,borderRadius:999,padding:"4px 12px",fontSize:11,fontWeight:800}}>{order.status}</span>
      </div>

      <p style={{fontSize:16,fontWeight:800,color:D.text,margin:"0 0 10px"}}>{order.items.map(i=>i.product).join(" + ")}</p>

      {order.items.map((item,idx)=>{
        const entries=getItemEntries(item);
        return (
          <div key={idx} style={{background:D.surface2,border:`1px solid ${D.border}`,borderRadius:10,padding:"10px 12px",marginBottom:8}}>
            <p style={{fontSize:12,color:D.textMuted,fontWeight:700,marginBottom:6,margin:"0 0 6px"}}>{idx+1}. {item.product}</p>
            {entries.map((e,ei)=>(
              <div key={ei} style={{display:"flex",alignItems:"center",gap:8,fontSize:13,padding:"5px 0",borderBottom:ei<entries.length-1?`1px solid ${D.border}`:"none"}}>
                <span style={{width:11,height:11,borderRadius:"50%",background:e.colorCode,border:`1px solid ${D.border2}`,flexShrink:0,display:"inline-block"}}/>
                <span style={{flex:1,fontWeight:700,color:D.text}}>{e.name||"بدون اسم"}</span>
                <span style={{color:D.textMuted,fontSize:12}}>العدد: {e.qty} · {e.colorName}</span>
              </div>
            ))}
            {item.notes && <p style={{fontSize:12,color:D.textDim,margin:"6px 0 0"}}>{item.notes}</p>}
            {item.image && <img src={item.image} alt="صورة" style={{width:"100%",maxHeight:180,objectFit:"cover",borderRadius:8,marginTop:8,border:`1px solid ${D.border}`}}/>}
          </div>
        );
      })}

      <hr style={{border:"none",borderTop:`1px solid ${D.border}`,margin:"12px 0"}}/>

      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:12}}>
        {[["الزبون",`${order.customer.name} · ${fmtPhone(order.customer.phone)}`],["العنوان",`${order.customer.city} / ${order.customer.address}`],["تاريخ الطلب",fmtDate(order.createdAtISO||order.createdAt)],["التتبع",order.tracking||"لا يوجد"]].map(([l,v])=>(
          <div key={l}>
            <div style={{fontSize:11,color:D.textDim,marginBottom:2}}>{l}</div>
            <div style={{fontSize:13,fontWeight:700,color:D.text}}>{v}</div>
          </div>
        ))}
      </div>

      {/* ✅ قسم المبالغ مع السعر الكلي */}
      <div style={{display:"flex",background:D.surface2,borderRadius:10,border:`1px solid ${D.border}`,marginBottom:12,flexWrap:"wrap",overflow:"hidden"}}>
        {[
          ["السعر",fmt(order.price),D.text],
          ["العربون",fmt(order.deposit),D.text],
          ["المتبقي",fmt(Number(order.price)-Number(order.deposit)),"#60a5fa"],
          ["التوصيل",fmt(DELIVERY_FEE),D.text],
          ["السعر الكلي",fmt(total),D.green],
        ].map(([l,v,c],i,arr)=>(
          <div key={l} style={{padding:"10px 14px",flex:1,minWidth:70,borderRight:i<arr.length-1?`1px solid ${D.border}`:"none"}}>
            <div style={{fontSize:10,color:D.textDim,marginBottom:3}}>{l}</div>
            <div style={{fontSize:l==="السعر الكلي"?14:13,fontWeight:l==="السعر الكلي"?900:700,color:c}}>{v}</div>
          </div>
        ))}
      </div>

      <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:10}}>
        <a href={waLink} target="_blank" rel="noreferrer" style={{background:"#0d2a1a",border:"1px solid #1a5c34",color:"#4ade80",borderRadius:8,padding:"7px 12px",textDecoration:"none",fontSize:12,fontWeight:800}}>📱 واتساب</a>
        <button style={{background:D.surface2,border:`1px solid ${D.border}`,color:D.textMuted,borderRadius:8,padding:"7px 12px",fontSize:12,fontWeight:800,cursor:"pointer",fontFamily:"Cairo,inherit"}} onClick={()=>downloadPDF(invoiceHtml(order),`invoice-${order.id}.pdf`)}>🧾 فاتورة</button>
        <button style={{background:D.accentBg,border:"1px solid #1d4ed8",color:D.accent,borderRadius:8,padding:"7px 12px",fontSize:12,fontWeight:800,cursor:"pointer",fontFamily:"Cairo,inherit"}} onClick={()=>startEdit(order)}>✏️ تعديل</button>
        <button style={{background:D.redBg,border:"1px solid #7f1d1d",color:D.red,borderRadius:8,padding:"7px 12px",fontSize:12,fontWeight:800,cursor:"pointer",fontFamily:"Cairo,inherit"}} onClick={()=>delOrder(order.id)}>🗑 حذف</button>
      </div>

      <div style={{display:"flex",gap:6,flexWrap:"wrap",paddingTop:10,borderTop:`1px solid ${D.border}`}}>
        {statuses.map(st=>{
          const active=order.status===st;
          const ss2=STATUS_STYLE[st]||{};
          return <button key={st} style={{border:active?`1px solid ${ss2.dot||"#888"}`:`1px solid ${D.border}`,background:active?(ss2.bg||"#222"):"transparent",color:active?(ss2.color||"#eee"):D.textMuted,borderRadius:999,padding:"4px 10px",fontSize:11,cursor:"pointer",fontWeight:700,fontFamily:"Cairo,inherit"}} onClick={()=>updateStatus(order.id,st)}>{st}</button>;
        })}
      </div>
    </div>
  );
}
