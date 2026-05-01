import React, { useEffect, useMemo, useState } from "react";
import html2pdf from "html2pdf.js/dist/html2pdf.bundle.min.js";

const DISCORD_WEBHOOK_URL = import.meta.env.VITE_DISCORD_WEBHOOK_URL || "";

const DELIVERY_COMPANY = "الوسيط";
const DELIVERY_FEE = 5000;
const DEFAULT_STATUS = "تحت التصميم";

const provinces = [
  "بغداد", "البصرة", "نينوى", "أربيل", "النجف", "كربلاء", "السليمانية", "دهوك", "كركوك", "ديالى", "الأنبار", "بابل", "واسط", "صلاح الدين", "الديوانية", "ذي قار", "ميسان", "المثنى"
];

const defaultColors = [
  { name: "أسود", code: "#111827" },
  { name: "أبيض", code: "#ffffff" },
  { name: "أحمر", code: "#dc2626" },
  { name: "أزرق", code: "#2563eb" },
  { name: "أخضر", code: "#16a34a" },
];

const defaultProducts = ["حافظة كيبل", "ميدالية", "مجسم 3D", "ستاند", "شعار", "قطعة خاصة"];
const statuses = ["تحت التصميم", "تحت الطباعة", "جاهز", "قيد التوصيل", "مكتمل", "ملغي"];

const defaultOrders = [
  {
    id: "O-5001",
    status: "تحت الطباعة",
    customer: { name: "احمد علي", phone: "07701234567", city: "بغداد", address: "المنصور" },
    items: [
      {
        product: "حافظة كيبل",
        entries: [
          { name: "احمد", qty: 1, colorName: "أسود", colorCode: "#111827" },
          { name: "علي", qty: 1, colorName: "أحمر", colorCode: "#dc2626" },
        ],
        notes: "قياس عادي",
      },
    ],
    price: 35000,
    deposit: 10000,
    tracking: "TRK-8821",
    notes: "",
    createdAt: new Date().toLocaleString("ar-IQ"),
  },
];

function loadData(key, fallback) {
  try {
    const saved = localStorage.getItem(key);
    return saved ? JSON.parse(saved) : fallback;
  } catch {
    return fallback;
  }
}

async function sendDiscord(message) {
  if (!DISCORD_WEBHOOK_URL) return;
  try {
    await fetch(DISCORD_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: message }),
    });
  } catch (error) {
    console.error("Discord webhook error:", error);
  }
}

function normalizePhone(phone) {
  return String(phone || "").replace(/\D/g, "").trim();
}

function getIraqWhatsAppNumber(phone) {
  let digits = normalizePhone(phone);

  // يقبل الصيغ: 0770..., 770..., 964770..., 00964770...
  if (digits.startsWith("00964")) digits = digits.slice(2);
  if (digits.startsWith("964")) return digits;
  if (digits.startsWith("0")) return `964${digits.slice(1)}`;
  return `964${digits}`;
}

function makeWhatsAppLink(phone, message) {
  return `https://wa.me/${getIraqWhatsAppNumber(phone)}?text=${encodeURIComponent(message)}`;
}

function emptyEntry(colors) {
  const firstColor = colors[0] || { name: "", code: "#000000" };
  return { name: "", qty: 1, colorName: firstColor.name, colorCode: firstColor.code };
}

function emptyItem(colors, products) {
  return {
    product: products[0] || "حافظة كيبل",
    entries: [emptyEntry(colors)],
    notes: "",
    image: null,
  };
}

function getItemEntries(item) {
  if (item.entries) return item.entries;
  if (item.names) {
    return item.names.map((name) => ({
      name,
      qty: item.qty || 1,
      colorName: item.colorName || "",
      colorCode: item.colorCode || "#000000",
    }));
  }
  return [];
}


function parseOrderDate(order) {
  const value = order.createdAtISO || order.createdAt;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

function formatMoney(value) {
  return `${Number(value || 0).toLocaleString()} د.ع`;
}

function buildFormalWhatsAppMessage(order) {
  const itemsText = order.items
    .map((item, idx) => {
      const entries = getItemEntries(item)
        .map((e) => `- ${e.name || "بدون اسم"} | العدد: ${e.qty}`)
        .join("\n");
      return `${idx + 1}) ${item.product}\n${entries}`;
    })
    .join("\n\n");

return (
  `السلام عليكم ورحمة الله وبركاته\n` +
  `عندكم طلب من الطباعة ثلاثية الأبعاد من متجر نايت ستور.\n\n` +
  `https://www.instagram.com/night_99q\n\n` +
  `اسم الزبون: ${order.customer.name}\n` +
  `رقم الهاتف: 964${order.customer.phone.replace(/^0/, "")}\n` +
  `رقم الطلب: ${order.id}\n\n` +
  `تفاصيل الطلب:\n${itemsText}\n\n` +
  `مبلغ الطلب: ${formatMoney(order.price)}\n` +
  `أجور التوصيل: ${formatMoney(DELIVERY_FEE)}\n\n` +
  `شكراً لاختياركم نايت ستور.`
);
}

function invoiceHtml(order) {
const rows = order.items.map((item, idx) => {
  const entries = getItemEntries(item)
    .map((e) => `<div>${e.name || "بدون اسم"} - العدد: ${e.qty}</div>`)
    .join("");

  const imageHtml = item.image
    ? `<img src="${item.image}" style="width:70px;height:70px;object-fit:cover;border-radius:8px;border:1px solid #cbd5e1;margin-top:6px;" />`
    : "";

  return `
    <tr>
      <td style="border:1px solid #cbd5e1;padding:10px;">${idx + 1}</td>
      <td style="border:1px solid #cbd5e1;padding:10px;">${item.product}</td>
      <td style="border:1px solid #cbd5e1;padding:10px;">
        ${entries}
        ${imageHtml}
      </td>
    </tr>
  `;
}).join("");

  return `
    <div dir="rtl" style="font-family: Tahoma, Arial, sans-serif; padding: 28px; color: #111827; background: #ffffff; width: 760px; box-sizing: border-box;">
      <div style="border-bottom:2px solid #111827; padding-bottom:14px; margin-bottom:18px;">
        <h1 style="margin:0; font-size:28px;">فاتورة طلب</h1>
        <p style="margin:6px 0 0; font-size:16px;">متجر نايت ستور - الطباعة ثلاثية الأبعاد</p>
        <p style="margin:6px 0 0;"><b>رقم الطلب:</b> ${order.id}</p>
      </div>
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-bottom:16px; font-size:15px;">
        <div><b>اسم الزبون:</b> ${order.customer.name || ""}</div>
        <div><b>رقم الهاتف:</b> ${order.customer.phone || ""}</div>
        <div><b>المحافظة:</b> ${order.customer.city || ""}</div>
        <div><b>العنوان:</b> ${order.customer.address || "غير محدد"}</div>
      </div>
      <table style="width:100%; border-collapse:collapse; margin:14px 0; font-size:15px;">
        <thead><tr style="background:#eff6ff;"><th style="border:1px solid #cbd5e1;padding:10px;">#</th><th style="border:1px solid #cbd5e1;padding:10px;">المنتج</th><th style="border:1px solid #cbd5e1;padding:10px;">التفاصيل</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <div style="margin-top:18px; padding:16px; border:1px solid #cbd5e1; border-radius:12px; background:#f8fafc; font-size:17px; line-height:2;">
        <div><b>مبلغ الطلب:</b> ${formatMoney(order.price)}</div>
        <div><b>العربون:</b> ${formatMoney(order.deposit)}</div>
        <div><b>المتبقي:</b> ${formatMoney(Number(order.price || 0) - Number(order.deposit || 0))}</div>
        <div><b>أجور التوصيل:</b> ${formatMoney(DELIVERY_FEE)}</div>
        <div><b>شركة التوصيل:</b> ${DELIVERY_COMPANY}</div>
      </div>
      <p style="margin-top:20px; text-align:center; font-weight:bold;">شكراً لاختياركم متجر نايت ستور</p>
    </div>
  `;
}

function downloadHtmlAsPDF(html, filename) {
  const holder = document.createElement("div");
  holder.style.position = "fixed";
  holder.style.left = "-10000px";
  holder.style.top = "0";
  holder.innerHTML = html;
  document.body.appendChild(holder);
  const element = holder.firstElementChild || holder;
  html2pdf().set({
    margin: 8,
    filename,
    image: { type: "jpeg", quality: 0.98 },
    html2canvas: { scale: 2, useCORS: true },
    jsPDF: { unit: "mm", format: "a4", orientation: "portrait" },
  }).from(element).save().finally(() => holder.remove());
}

function downloadInvoicePDF(order) {
  downloadHtmlAsPDF(invoiceHtml(order), `invoice-${order.id}.pdf`);
}

export default function App() {
  const [page, setPage] = useState("orders");
  const [orders, setOrders] = useState(() => loadData("orders_v4", defaultOrders));
  const [colors, setColors] = useState(() => loadData("colors_v2", defaultColors));
  const [products, setProducts] = useState(() => loadData("products_v1", defaultProducts));
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("الكل");
  const [newColor, setNewColor] = useState({ name: "", code: "#000000" });
  const [newProduct, setNewProduct] = useState("");
  const [editingOrderId, setEditingOrderId] = useState(null);

  const [orderForm, setOrderForm] = useState({
    customerName: "",
    phone: "",
    city: "بغداد",
    address: "",
    items: [emptyItem(defaultColors, defaultProducts)],
    price: "",
    deposit: "",
    tracking: "",
    notes: "",
  });

  useEffect(() => localStorage.setItem("orders_v4", JSON.stringify(orders)), [orders]);
  useEffect(() => localStorage.setItem("colors_v2", JSON.stringify(colors)), [colors]);
  useEffect(() => localStorage.setItem("products_v1", JSON.stringify(products)), [products]);

  const customers = useMemo(() => {
    const map = new Map();
    orders.forEach((order) => {
      const key = normalizePhone(order.customer.phone || order.customer.name);
      const old = map.get(key);
      map.set(key, {
        ...order.customer,
        total: (old?.total || 0) + Number(order.price || 0),
        count: (old?.count || 0) + 1,
      });
    });
    return Array.from(map.values());
  }, [orders]);

const filteredOrders = useMemo(() => {
  const q = search.trim();

  return orders.filter((o) => {
    const itemsText = o.items
      .map((i) =>
        `${i.product} ${getItemEntries(i)
          .map((e) => `${e.name} ${e.colorName}`)
          .join(" ")}`
      )
      .join(" ");

    const text = `${o.id} ${o.status} ${o.customer.name} ${o.customer.phone} ${o.customer.city} ${itemsText}`;

    const matchSearch = text.includes(q);
    const matchStatus = statusFilter === "الكل" || o.status === statusFilter;

    return matchSearch && matchStatus;
  });
}, [orders, search, statusFilter]);

  const filteredCustomers = useMemo(() => {
    const q = search.trim();
    return customers.filter((c) => `${c.name} ${c.phone} ${c.city} ${c.address}`.includes(q));
  }, [customers, search]);


  const moneyStats = useMemo(() => {
    const now = new Date();
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - 6);
    startOfWeek.setHours(0, 0, 0, 0);
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const completed = orders.filter((o) => o.status === "مكتمل");
    const completedTotal = completed.reduce((sum, o) => sum + Number(o.price || 0), 0);
    const weeklyCompleted = completed.filter((o) => parseOrderDate(o) >= startOfWeek);
    const monthlyCompleted = completed.filter((o) => parseOrderDate(o) >= startOfMonth);
    return {
      completedTotal,
      weeklyCompletedTotal: weeklyCompleted.reduce((sum, o) => sum + Number(o.price || 0), 0),
      monthlyCompletedTotal: monthlyCompleted.reduce((sum, o) => sum + Number(o.price || 0), 0),
      completedCount: completed.length,
      weeklyCompletedCount: weeklyCompleted.length,
      monthlyCompletedCount: monthlyCompleted.length,
    };
  }, [orders]);

  function updateItem(index, patch) {
    const items = [...orderForm.items];
    items[index] = { ...items[index], ...patch };
    setOrderForm({ ...orderForm, items });
  }

  function addItem() {
    setOrderForm({ ...orderForm, items: [...orderForm.items, emptyItem(colors, products)] });
  }

  function removeItem(index) {
    if (orderForm.items.length === 1) return;
    setOrderForm({ ...orderForm, items: orderForm.items.filter((_, i) => i !== index) });
  }

  function updateEntry(itemIndex, entryIndex, patch) {
    const item = orderForm.items[itemIndex];
    const entries = [...item.entries];
    entries[entryIndex] = { ...entries[entryIndex], ...patch };
    updateItem(itemIndex, { entries });
  }

  function addEntryToItem(itemIndex) {
    const item = orderForm.items[itemIndex];
    updateItem(itemIndex, { entries: [...item.entries, emptyEntry(colors)] });
  }

  function removeEntryFromItem(itemIndex, entryIndex) {
    const item = orderForm.items[itemIndex];
    if (item.entries.length === 1) return;
    updateItem(itemIndex, { entries: item.entries.filter((_, i) => i !== entryIndex) });
  }

  function resetOrderForm() {
    setEditingOrderId(null);
    setOrderForm({
      customerName: "",
      phone: "",
      city: "بغداد",
      address: "",
      items: [emptyItem(colors, products)],
      price: "",
      deposit: "",
      tracking: "",
      notes: "",
    });
  }

  function submitOrder() {
    if (!orderForm.customerName || !orderForm.phone || !orderForm.items[0]?.product) {
      return alert("اكتب اسم الزبون ورقم الهاتف وتفاصيل الطلب");
    }

    const cleanItems = orderForm.items.map((item) => ({
      ...item,
      entries: item.entries.map((entry) => ({
        ...entry,
        name: entry.name.trim(),
        qty: Number(entry.qty || 1),
      })).filter((entry) => entry.name),
    }));

    const oldOrder = orders.find((o) => o.id === editingOrderId);
    const savedOrder = {
      id: editingOrderId || `O-${5001 + orders.length}`,
      status: oldOrder?.status || DEFAULT_STATUS,
      customer: {
        name: orderForm.customerName,
        phone: normalizePhone(orderForm.phone),
        city: orderForm.city,
        address: orderForm.address,
      },
      items: cleanItems,
      price: Number(orderForm.price || 0),
      deposit: Number(orderForm.deposit || 0),
      tracking: orderForm.tracking,
      notes: orderForm.notes,
      createdAt: oldOrder?.createdAt || new Date().toLocaleString("ar-IQ"),
      createdAtISO: oldOrder?.createdAtISO || new Date().toISOString(),
      updatedAt: new Date().toLocaleString("ar-IQ"),
    };

    if (editingOrderId) {
      setOrders(orders.map((o) => (o.id === editingOrderId ? savedOrder : o)));
      sendDiscord(`✏️ تم تعديل طلب\nرقم الطلب: ${savedOrder.id}\nالزبون: ${savedOrder.customer.name}`);
    } else {
      setOrders([savedOrder, ...orders]);
      const itemsText = savedOrder.items.map((i, idx) => {
        const lines = getItemEntries(i).map((e, eIdx) => `   ${eIdx + 1}- الاسم: ${e.name} | العدد: ${e.qty} | اللون: ${e.colorName}`).join("\n");
        return `${idx + 1}) ${i.product}\n${lines}`;
      }).join("\n");

      sendDiscord(
        `🧾 طلب جديد\n` +
        `رقم الطلب: ${savedOrder.id}\n` +
        `الحالة: ${savedOrder.status}\n` +
        `الزبون: ${savedOrder.customer.name}\n` +
        `الهاتف: ${savedOrder.customer.phone}\n` +
        `العنوان: ${savedOrder.customer.city} / ${savedOrder.customer.address}\n` +
        `المنتجات:\n${itemsText}\n` +
        `السعر: ${savedOrder.price.toLocaleString()} د.ع\n` +
        `العربون: ${savedOrder.deposit.toLocaleString()} د.ع\n` +
        `المتبقي: ${(savedOrder.price - savedOrder.deposit).toLocaleString()} د.ع\n` +
        `شركة التوصيل: ${DELIVERY_COMPANY}\n` +
        `أجرة التوصيل: ${DELIVERY_FEE.toLocaleString()} د.ع\n` +
        `ملاحظات: ${savedOrder.notes || "لا يوجد"}`
      );
    }

    resetOrderForm();
    setPage("orders");
  }

  function startEditOrder(order) {
    setEditingOrderId(order.id);
    setOrderForm({
      customerName: order.customer.name || "",
      phone: order.customer.phone || "",
      city: order.customer.city || "بغداد",
      address: order.customer.address || "",
      items: order.items.map((item) => ({
        product: item.product,
        notes: item.notes || "",
        image: item.image || null,
        entries: getItemEntries(item).map((entry) => ({
          name: entry.name || "",
          qty: entry.qty || 1,
          colorName: entry.colorName || colors[0]?.name || "",
          colorCode: entry.colorCode || colors[0]?.code || "#000000",
        })),
      })),
      price: String(order.price || ""),
      deposit: String(order.deposit || ""),
      tracking: order.tracking || "",
      notes: order.notes || "",
    });
    setPage("newOrder");
  }

  function exportCustomersPDF() {
    const rows = filteredCustomers.map((c, index) => `
      <tr>
        <td style="border:1px solid #cbd5e1; padding:10px;">${index + 1}</td>
        <td style="border:1px solid #cbd5e1; padding:10px;">${c.name || ""}</td>
        <td style="border:1px solid #cbd5e1; padding:10px;">${c.phone || ""}</td>
        <td style="border:1px solid #cbd5e1; padding:10px;">${c.city || ""}</td>
        <td style="border:1px solid #cbd5e1; padding:10px;">${c.address || ""}</td>
        <td style="border:1px solid #cbd5e1; padding:10px;">${c.count || 0}</td>
        <td style="border:1px solid #cbd5e1; padding:10px;">${formatMoney(c.total)}</td>
      </tr>
    `).join("");

    const html = `
      <div dir="rtl" style="font-family: Tahoma, Arial, sans-serif; padding: 28px; color: #111827; background:#ffffff; width: 900px; box-sizing:border-box;">
        <h1 style="margin: 0 0 8px;">تقرير الزبائن - متجر نايت ستور</h1>
        <p style="margin: 0 0 18px; color: #475569;">تاريخ التصدير: ${new Date().toLocaleString("ar-IQ")}</p>
        <table style="width:100%; border-collapse:collapse; font-size:14px;">
          <thead>
            <tr style="background:#eff6ff;">
              <th style="border:1px solid #cbd5e1; padding:10px;">#</th>
              <th style="border:1px solid #cbd5e1; padding:10px;">اسم الزبون</th>
              <th style="border:1px solid #cbd5e1; padding:10px;">رقم الهاتف</th>
              <th style="border:1px solid #cbd5e1; padding:10px;">المحافظة</th>
              <th style="border:1px solid #cbd5e1; padding:10px;">العنوان</th>
              <th style="border:1px solid #cbd5e1; padding:10px;">عدد الطلبات</th>
              <th style="border:1px solid #cbd5e1; padding:10px;">الإجمالي</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    `;

    downloadHtmlAsPDF(html, "customers-report-night-store.pdf");
  }

  function updateOrderStatus(orderId, status) {
    const oldOrder = orders.find((o) => o.id === orderId);
    setOrders(orders.map((o) => (o.id === orderId ? { ...o, status } : o)));
    sendDiscord(`🔄 تحديث حالة طلب\nرقم الطلب: ${orderId}\nالزبون: ${oldOrder?.customer.name || ""}\nالحالة الجديدة: ${status}`);
  }

  function deleteOrder(orderId) {
    if (!confirm("متأكد تريد حذف الطلب؟")) return;
    setOrders(orders.filter((o) => o.id !== orderId));
  }

  function addColor() {
    const name = newColor.name.trim();
    if (!name) return;
    if (colors.some((c) => c.name === name)) return alert("هذا اللون موجود مسبقاً");
    setColors([...colors, { name, code: newColor.code }]);
    setNewColor({ name: "", code: "#000000" });
  }

  function deleteColor(name) {
    setColors(colors.filter((c) => c.name !== name));
  }

  function addProduct() {
    const product = newProduct.trim();
    if (!product) return;
    if (products.includes(product)) return alert("هذا المنتج موجود مسبقاً");
    setProducts([...products, product]);
    setNewProduct("");
  }

  function deleteProduct(product) {
    setProducts(products.filter((p) => p !== product));
  }

  function clearAllData() {
    if (!confirm("متأكد تريد حذف كل البيانات؟")) return;
    setOrders([]);
    localStorage.removeItem("orders_v4");
  }

  return (
    <div dir="rtl" style={styles.app}>
      <header style={styles.topbar}>
        <div>
          <h1 style={styles.title}>نظام طلبات متجر 3D</h1>
          <p style={styles.subtitle}>طلبات + زبائن تلقائي + لون وعدد لكل اسم + منتجات + Backup Discord</p>
        </div>
        <div style={styles.buttons}>
          <button style={page === "orders" ? styles.activeButton : styles.button} onClick={() => setPage("orders")}>الطلبات</button>
          <button style={page === "customers" ? styles.activeButton : styles.button} onClick={() => setPage("customers")}>الزبائن</button>
          <button style={page === "colors" ? styles.activeButton : styles.button} onClick={() => setPage("colors")}>الألوان</button>
          <button style={page === "products" ? styles.activeButton : styles.button} onClick={() => setPage("products")}>المنتجات</button>
          <button style={page === "reports" ? styles.activeButton : styles.button} onClick={() => setPage("reports")}>التقارير</button>
          <button style={styles.primaryButton} onClick={() => { resetOrderForm(); setPage("newOrder"); }}>+ طلب جديد</button>
          <button style={styles.dangerButton} onClick={clearAllData}>حذف الكل</button>
        </div>
      </header>

      <section style={styles.stats}>
        <Stat title="كل الطلبات" value={orders.length} />
        <Stat title="الزبائن" value={customers.length} />
        <Stat title="تحت التصميم" value={orders.filter((o) => o.status === "تحت التصميم").length} />
        <Stat title="تحت الطباعة" value={orders.filter((o) => o.status === "تحت الطباعة").length} />
        <Stat title="قيد التوصيل" value={orders.filter((o) => o.status === "قيد التوصيل").length} />
        <Stat title="مبالغ مكتملة هذا الأسبوع" value={formatMoney(moneyStats.weeklyCompletedTotal)} />
        <Stat title="مبالغ مكتملة هذا الشهر" value={formatMoney(moneyStats.monthlyCompletedTotal)} />
      </section>

      <input style={styles.search} placeholder="بحث باسم الزبون أو الرقم أو الطلب أو اللون..." value={search} onChange={(e) => setSearch(e.target.value)} />

      <div style={{ ...styles.buttons, marginTop: 12 }}>
  {["الكل", ...statuses].map((s) => (
    <button
      key={s}
      style={statusFilter === s ? styles.activeButton : styles.button}
      onClick={() => setStatusFilter(s)}
    >
      {s}
    </button>
  ))}
</div>

      {page === "orders" && <div style={styles.grid}>{filteredOrders.map((o) => <OrderCard key={o.id} order={o} updateOrderStatus={updateOrderStatus} deleteOrder={deleteOrder} startEditOrder={startEditOrder} />)}</div>}
      {page === "customers" && (
        <>
          <div style={styles.exportRow}><button style={styles.primaryButton} onClick={exportCustomersPDF}>تحميل قائمة الزبائن PDF</button></div>
          <div style={styles.gridTwo}>{filteredCustomers.map((c) => <CustomerCard key={c.phone} customer={c} />)}</div>
        </>
      )}

      {page === "colors" && (
        <div style={styles.form}>
          <h2 style={styles.formTitle}>مخزن الألوان والدرجات</h2>
          <div style={styles.inlineForm}>
            <input style={styles.input} value={newColor.name} onChange={(e) => setNewColor({ ...newColor, name: e.target.value })} placeholder="اسم اللون: PLA أسود مطفي / أزرق فاتح" />
            <input style={styles.colorPicker} type="color" value={newColor.code} onChange={(e) => setNewColor({ ...newColor, code: e.target.value })} />
            <button style={styles.primaryButton} onClick={addColor}>إضافة لون</button>
          </div>
          <div style={styles.colorList}>{colors.map((color) => <ColorChip key={color.name} color={color} onDelete={() => deleteColor(color.name)} />)}</div>
        </div>
      )}

      {page === "products" && (
        <div style={styles.form}>
          <h2 style={styles.formTitle}>إضافة منتجات</h2>
          <div style={styles.inlineFormTwo}>
            <input style={styles.input} value={newProduct} onChange={(e) => setNewProduct(e.target.value)} placeholder="مثال: حافظة كيبل / ميدالية / ستاند" />
            <button style={styles.primaryButton} onClick={addProduct}>إضافة منتج</button>
          </div>
          <div style={styles.colorList}>{products.map((p) => <span key={p} style={styles.productChip}>{p}<button style={styles.xButton} onClick={() => deleteProduct(p)}>×</button></span>)}</div>
        </div>
      )}


      {page === "reports" && (
        <div style={styles.form}>
          <h2 style={styles.formTitle}>التقارير والإحصائيات</h2>
          <div style={styles.stats}>
            <Stat title="عدد الطلبات المكتملة" value={moneyStats.completedCount} />
            <Stat title="مبالغ مكتملة كلياً" value={formatMoney(moneyStats.completedTotal)} />
            <Stat title="مكتملة هذا الأسبوع" value={`${moneyStats.weeklyCompletedCount} طلب`} />
            <Stat title="مبالغ هذا الأسبوع" value={formatMoney(moneyStats.weeklyCompletedTotal)} />
            <Stat title="مكتملة هذا الشهر" value={`${moneyStats.monthlyCompletedCount} طلب`} />
            <Stat title="مبالغ هذا الشهر" value={formatMoney(moneyStats.monthlyCompletedTotal)} />
          </div>
          <h3 style={styles.sectionTitle}>قائمة الزبائن</h3>
          <button style={styles.primaryButton} onClick={exportCustomersPDF}>تحميل أسماء وأرقام الزبائن PDF</button>
          <div style={styles.tableWrap}>
            <table style={styles.table}>
              <thead>
                <tr><th>اسم الزبون</th><th>رقم الهاتف</th><th>المحافظة</th><th>العنوان</th><th>عدد الطلبات</th><th>الإجمالي</th></tr>
              </thead>
              <tbody>
                {filteredCustomers.map((c) => (
                  <tr key={c.phone}>
                    <td>{c.name}</td><td>{c.phone}</td><td>{c.city}</td><td>{c.address}</td><td>{c.count}</td><td>{formatMoney(c.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {page === "newOrder" && (
        <Form title={editingOrderId ? `تعديل الطلب ${editingOrderId}` : "إضافة طلب جديد"}>
          <h3 style={styles.sectionTitle}>معلومات الزبون</h3>
          <Input label="اسم الزبون" value={orderForm.customerName} onChange={(v) => setOrderForm({ ...orderForm, customerName: v })} />
          <Input label="رقم الهاتف / واتساب" value={orderForm.phone} onChange={(v) => setOrderForm({ ...orderForm, phone: v })} />
          <label style={styles.label}>المحافظة
            <input style={styles.input} list="province-list" value={orderForm.city} onChange={(e) => setOrderForm({ ...orderForm, city: e.target.value })} placeholder="ابحث عن المحافظة" />
            <datalist id="province-list">{provinces.map((p) => <option key={p} value={p} />)}</datalist>
          </label>
          <Input label="العنوان التفصيلي" value={orderForm.address} onChange={(v) => setOrderForm({ ...orderForm, address: v })} />

          <h3 style={styles.sectionTitle}>تفاصيل المنتجات</h3>
          {orderForm.items.map((item, index) => (
            <div key={index} style={styles.itemBox}>
              <div style={styles.row}>
                <h3 style={styles.itemTitle}>منتج رقم {index + 1}</h3>
                {orderForm.items.length > 1 && <button style={styles.deleteSmall} onClick={() => removeItem(index)}>حذف المنتج</button>}
              </div>

              <label style={styles.label}>المنتج
                <select style={styles.input} value={item.product} onChange={(e) => updateItem(index, { product: e.target.value })}>
                  {products.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
              </label>

              {item.product === "قطعة خاصة" && (
    <div style={styles.imageBox}>
    <label style={styles.label}>صورة القطعة الخاصة</label>

    <input
      style={styles.input}
      type="file"
      accept="image/*"
      onChange={(e) => {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader(); // ✅ مهم
  const canvas = document.createElement("canvas");
  const img = new Image();

  reader.onload = () => {
    img.src = reader.result;
  };

  img.onload = () => {
    const MAX = 600;
    let width = img.width;
    let height = img.height;

    if (width > MAX) {
      height *= MAX / width;
      width = MAX;
    }

    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0, width, height);

    const compressed = canvas.toDataURL("image/jpeg", 0.7);
    updateItem(index, { image: compressed });
  };

  reader.readAsDataURL(file);
}}

    />

    {item.image && (
      <img
        src={item.image}
        alt="صورة القطعة"
        style={styles.previewImage}
      />
    )}
  </div>
)}

              <div style={styles.namesBox}>
                <b>الأسماء على المنتج — لكل اسم لون وعدد خاص</b>
                {item.entries.map((entry, entryIndex) => (
                  <div key={entryIndex} style={styles.entryRow}>
                    <input style={styles.input} value={entry.name} onChange={(e) => updateEntry(index, entryIndex, { name: e.target.value })} placeholder={`الاسم ${entryIndex + 1}`} />
                    <input style={styles.input} type="number" value={entry.qty} onChange={(e) => updateEntry(index, entryIndex, { qty: e.target.value })} placeholder="العدد" />
                    <select style={styles.input} value={entry.colorName} onChange={(e) => {
                      const selected = colors.find((c) => c.name === e.target.value);
                      updateEntry(index, entryIndex, { colorName: selected?.name || "", colorCode: selected?.code || "#000000" });
                    }}>
                      {colors.map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
                    </select>
                    <div style={styles.entryColor}><span style={{ ...styles.colorDot, background: entry.colorCode }} />{entry.colorName}</div>
                    {item.entries.length > 1 && <button style={styles.smallDanger} onClick={() => removeEntryFromItem(index, entryIndex)}>حذف</button>}
                  </div>
                ))}
                <button style={styles.smallBlue} onClick={() => addEntryToItem(index)}>+ إضافة اسم ثاني</button>
              </div>

              <Input label="ملاحظات المنتج" value={item.notes} onChange={(v) => updateItem(index, { notes: v })} />
            </div>
          ))}

          <button style={styles.addItemButton} onClick={addItem}>+ إضافة منتج آخر</button>

          <h3 style={styles.sectionTitle}>الدفع والتوصيل</h3>
          <Input label="السعر" type="number" value={orderForm.price} onChange={(v) => setOrderForm({ ...orderForm, price: v })} />
          <Input label="العربون" type="number" value={orderForm.deposit} onChange={(v) => setOrderForm({ ...orderForm, deposit: v })} />
          <Input label="رقم تتبع الوسيط / اختياري" value={orderForm.tracking} onChange={(v) => setOrderForm({ ...orderForm, tracking: v })} />
          <Input label="ملاحظات عامة" value={orderForm.notes} onChange={(v) => setOrderForm({ ...orderForm, notes: v })} />
          <div style={styles.deliveryBox}>شركة التوصيل ثابتة: <b>{DELIVERY_COMPANY}</b> — أجرة التوصيل: <b>{DELIVERY_FEE.toLocaleString()} د.ع</b></div>
          <div style={styles.buttons}>
            <button style={styles.saveButton} onClick={submitOrder}>{editingOrderId ? "حفظ التعديل" : "حفظ الطلب"}</button>
            {editingOrderId && <button style={styles.button} onClick={resetOrderForm}>إلغاء التعديل</button>}
          </div>
        </Form>
      )}
    </div>
  );
}

function Stat({ title, value }) {
  return <div style={styles.card}><span style={styles.muted}>{title}</span><b style={styles.big}>{value}</b></div>;
}

function Form({ title, children }) {
  return <div style={styles.form}><h2 style={styles.formTitle}>{title}</h2>{children}</div>;
}

function Input({ label, value, onChange, type = "text" }) {
  return <label style={styles.label}>{label}<input style={styles.input} type={type} value={value} onChange={(e) => onChange(e.target.value)} /></label>;
}

function ColorChip({ color, onDelete }) {
  const border = color.code.toLowerCase() === "#ffffff" ? "#cbd5e1" : color.code;
  return <span style={{ ...styles.colorChip, borderColor: border }}><span style={{ ...styles.colorDot, background: color.code }} />{color.name}<button style={styles.xButton} onClick={onDelete}>×</button></span>;
}

function OrderCard({ order, updateOrderStatus, deleteOrder, startEditOrder }) {
  const whatsappMessage = buildFormalWhatsAppMessage(order);

  const whatsappLink = makeWhatsAppLink(order.customer.phone, whatsappMessage);

  return (
    <div style={styles.card}>
      <div style={styles.row}>
        <b style={styles.orderId}>{order.id}</b>
        <span style={styles.badge}>{order.status}</span>
      </div>

      <h2 style={styles.cardTitle}>{order.items.map((i) => i.product).join(" + ")}</h2>

      {order.items.map((item, idx) => (
        <div key={idx} style={styles.orderItemLine}>
          <b>
            {idx + 1}. {item.product}
          </b>
          {getItemEntries(item).map((entry, eIdx) => (
            <div key={eIdx} style={styles.orderEntryLine}>
              الاسم: <b>{entry.name || "بدون اسم"}</b> — العدد: <b>{entry.qty}</b> — اللون:{" "}
              <span style={{ ...styles.colorDotSmall, background: entry.colorCode }} />{" "}
              <b>{entry.colorName}</b>
            </div>
          ))}
          {item.notes && <div>ملاحظات المنتج: {item.notes}</div>}
          {item.image && (
  <img
    src={item.image}
    alt="صورة القطعة"
    style={{
      width: "100%",
      maxHeight: 220,
      objectFit: "cover",
      marginTop: 10,
      borderRadius: 10,
      border: "1px solid #cbd5e1"
    }}
  />
)}
        </div>
      ))}

      <p><b>الزبون:</b> {order.customer.name} - {order.customer.phone}</p>
      <p><b>العنوان:</b> {order.customer.city} / {order.customer.address}</p>
      <p><b>السعر:</b> {order.price.toLocaleString()} د.ع | <b>العربون:</b> {order.deposit.toLocaleString()} د.ع | <b>المتبقي:</b> {(order.price - order.deposit).toLocaleString()} د.ع</p>
      <p><b>التوصيل:</b> {DELIVERY_COMPANY} | <b>أجرة التوصيل:</b> {DELIVERY_FEE.toLocaleString()} د.ع | <b>التتبع:</b> {order.tracking || "لا يوجد"}</p>
      <p><b>ملاحظات:</b> {order.notes || "لا يوجد"}</p>

      <div style={{ ...styles.buttons, marginTop: 10 }}>
        <a href={whatsappLink} target="_blank" rel="noreferrer" style={styles.whatsappSend}>📱 إرسال للواتساب</a>
        <button style={styles.invoiceButton} onClick={() => downloadInvoicePDF(order)}>🧾 تحميل فاتورة PDF</button>
      </div>

      <div style={styles.buttons}>
        {statuses.map((s) => (
          <button style={order.status === s ? styles.statusActive : styles.smallButton} key={s} onClick={() => updateOrderStatus(order.id, s)}>
            {s}
          </button>
        ))}
      </div>
      <div style={styles.buttons}>
        <button style={styles.primaryButton} onClick={() => startEditOrder(order)}>تعديل الطلب</button>
        <button style={styles.deleteSmall} onClick={() => deleteOrder(order.id)}>حذف الطلب</button>
      </div>
    </div>
  );
}

function CustomerCard({ customer }) {
  const whatsapp = makeWhatsAppLink(customer.phone, `مرحبا ${customer.name}، عدنا عروض جديدة من متجر 3D`);
  return <div style={styles.card}>
    <div style={styles.row}><b>{customer.name}</b><a style={styles.whatsapp} href={whatsapp} target="_blank" rel="noreferrer">واتساب</a></div>
    <p><b>الهاتف:</b> {customer.phone}</p>
    <p><b>العنوان:</b> {customer.city} / {customer.address}</p>
    <p><b>عدد الطلبات:</b> {customer.count}</p>
    <p><b>إجمالي الشراء:</b> {customer.total.toLocaleString()} د.ع</p>
  </div>;
}

const styles = {
  app: { minHeight: "100vh", background: "#eef2f7", padding: 24, fontFamily: "Cairo, Tahoma, Arial, sans-serif", color: "#0f172a" },
  topbar: { background: "#ffffff", borderRadius: 24, padding: 24, display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap", boxShadow: "0 10px 35px #0f172a14", border: "1px solid #e5e7eb" },
  title: { margin: 0, fontSize: 30, color: "#0f172a", fontWeight: 900 },
  subtitle: { margin: "8px 0 0", color: "#475569" },
  buttons: { display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" },
  button: { border: "1px solid #cbd5e1", background: "#f8fafc", color: "#0f172a", borderRadius: 12, padding: "10px 14px", cursor: "pointer", fontWeight: 800 },
  activeButton: { border: "1px solid #1d4ed8", background: "#dbeafe", color: "#1d4ed8", borderRadius: 12, padding: "10px 14px", cursor: "pointer", fontWeight: 800 },
  primaryButton: { border: 0, background: "#2563eb", color: "white", borderRadius: 12, padding: "10px 14px", cursor: "pointer", fontWeight: 800 },
  dangerButton: { border: 0, background: "#dc2626", color: "white", borderRadius: 12, padding: "10px 14px", cursor: "pointer", fontWeight: 800 },
  smallButton: { border: "1px solid #cbd5e1", background: "#f8fafc", color: "#0f172a", borderRadius: 10, padding: "8px 10px", cursor: "pointer", fontWeight: 800 },
  statusActive: { border: "1px solid #16a34a", background: "#dcfce7", color: "#166534", borderRadius: 10, padding: "8px 10px", cursor: "pointer", fontWeight: 800 },
  deleteSmall: { marginTop: 12, border: 0, background: "#fee2e2", color: "#991b1b", borderRadius: 10, padding: "8px 10px", cursor: "pointer", fontWeight: 800 },
  smallDanger: { border: 0, background: "#fee2e2", color: "#991b1b", borderRadius: 10, padding: "8px 10px", cursor: "pointer", fontWeight: 800 },
  smallBlue: { border: 0, background: "#dbeafe", color: "#1d4ed8", borderRadius: 10, padding: "9px 12px", cursor: "pointer", fontWeight: 800, width: "fit-content" },
  addItemButton: { border: "1px dashed #2563eb", background: "#eff6ff", color: "#1d4ed8", borderRadius: 14, padding: 14, cursor: "pointer", fontWeight: 900 },
  stats: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 16, marginTop: 18 },
  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(380px, 1fr))", gap: 16, marginTop: 18 },
  gridTwo: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 16, marginTop: 18 },
  exportRow: { display: "flex", justifyContent: "flex-start", marginTop: 18 },
  tableWrap: { overflowX: "auto", background: "white", borderRadius: 16, border: "1px solid #e5e7eb" },
  table: { width: "100%", borderCollapse: "collapse", minWidth: 700 },
  card: { background: "white", borderRadius: 24, padding: 22, boxShadow: "0 10px 35px #0f172a12", border: "1px solid #e5e7eb" },
  form: { maxWidth: 980, margin: "18px auto", background: "white", borderRadius: 24, padding: 24, display: "grid", gap: 14, boxShadow: "0 10px 35px #0f172a12", border: "1px solid #e5e7eb" },
  formTitle: { margin: 0, color: "#0f172a", fontWeight: 900 },
  sectionTitle: { margin: "14px 0 0", color: "#1d4ed8", borderBottom: "1px solid #e5e7eb", paddingBottom: 8, fontWeight: 900 },
  search: { width: "100%", boxSizing: "border-box", marginTop: 18, border: "1px solid #cbd5e1", borderRadius: 16, padding: 16, fontSize: 16, outline: "none", background: "white", color: "#0f172a" },
  label: { display: "grid", gap: 8, fontWeight: 900, color: "#0f172a" },
  input: { border: "1px solid #cbd5e1", borderRadius: 14, padding: 12, fontSize: 15, outline: "none", background: "white", color: "#0f172a", fontFamily: "inherit", minWidth: 0 },
  colorPicker: { height: 46, width: 70, border: "1px solid #cbd5e1", borderRadius: 14, background: "white", padding: 4, cursor: "pointer" },
  saveButton: { border: 0, background: "#16a34a", color: "white", borderRadius: 14, padding: 15, fontSize: 17, cursor: "pointer", fontWeight: 900 },
  row: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" },
  orderId: { color: "#1e293b" },
  badge: { background: "#dbeafe", color: "#1d4ed8", borderRadius: 999, padding: "7px 12px", fontSize: 13, fontWeight: 900 },
  whatsapp: { background: "#dcfce7", color: "#166534", borderRadius: 999, padding: "8px 12px", textDecoration: "none", fontWeight: 900 },
  whatsappSend: { background: "#22c55e", color: "white", borderRadius: 12, padding: "10px 14px", textDecoration: "none", fontWeight: 900 },
  invoiceButton: { border: 0, background: "#0f172a", color: "white", borderRadius: 12, padding: "10px 14px", cursor: "pointer", fontWeight: 900 },
  muted: { color: "#475569" },
  big: { display: "block", fontSize: 28, marginTop: 8, color: "#0f172a" },
  cardTitle: { color: "#0f172a", marginBottom: 10, fontWeight: 900 },
  deliveryBox: { background: "#eff6ff", color: "#1e3a8a", border: "1px solid #bfdbfe", padding: 14, borderRadius: 14 },
  inlineForm: { display: "grid", gridTemplateColumns: "1fr auto auto", gap: 10, alignItems: "center" },
  inlineFormTwo: { display: "grid", gridTemplateColumns: "1fr auto", gap: 10, alignItems: "center" },
  colorList: { display: "flex", flexWrap: "wrap", gap: 10, marginTop: 10 },
  colorChip: { display: "inline-flex", alignItems: "center", gap: 8, background: "#f8fafc", color: "#0f172a", border: "2px solid #cbd5e1", borderRadius: 999, padding: "8px 12px", fontWeight: 900 },
  productChip: { background: "#f1f5f9", color: "#0f172a", border: "1px solid #cbd5e1", borderRadius: 999, padding: "8px 12px", fontWeight: 900 },
  xButton: { marginRight: 8, border: 0, background: "#fee2e2", color: "#991b1b", borderRadius: 999, cursor: "pointer", fontWeight: 900 },
  colorDot: { display: "inline-block", width: 18, height: 18, borderRadius: "50%", border: "1px solid #94a3b8", verticalAlign: "middle" },
  colorDotSmall: { display: "inline-block", width: 12, height: 12, borderRadius: "50%", border: "1px solid #94a3b8", verticalAlign: "middle" },
  itemBox: { display: "grid", gap: 12, background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 18, padding: 16 },
  itemTitle: { margin: 0, color: "#0f172a", fontWeight: 900 },
  namesBox: { display: "grid", gap: 10 },
  entryRow: { display: "grid", gridTemplateColumns: "1.5fr 90px 1fr 150px auto", gap: 8, alignItems: "center" },
  entryColor: { background: "white", border: "1px solid #e2e8f0", borderRadius: 12, padding: 10, display: "flex", gap: 8, alignItems: "center", fontWeight: 800 },
  orderItemLine: { background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 12, padding: 10, margin: "8px 0" },
  orderEntryLine: { marginTop: 8, paddingTop: 8, borderTop: "1px solid #e2e8f0" },

  imageBox: {
    display: "grid",
    gap: 10,
    background: "#ffffff",
    border: "1px dashed #94a3b8",
    borderRadius: 14,
    padding: 12,
  },

  previewImage: {
    width: 160,
    maxHeight: 160,
    objectFit: "cover",
    borderRadius: 12,
    border: "1px solid #cbd5e1",
  },
};
