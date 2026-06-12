// ═══════════════════════════════════════════════════════════
//  /api/waseet-create-order  (CommonJS)
//  ينشئ طلب توصيل بشركة الوسيط ويرجع qr_id و qr_link
// ═══════════════════════════════════════════════════════════

const { waseetPost, setCors } = require("./_waseet.js");

module.exports = async function handler(req, res) {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method !== "POST") {
    return res.status(405).json({ status: false, msg: "POST فقط" });
  }

  try {
    const b = req.body || {};

    const required = ["client_name", "client_mobile", "city_id", "region_id", "location", "type_name", "items_number", "price", "package_size"];
    for (const field of required) {
      if (b[field] === undefined || b[field] === null || b[field] === "") {
        return res.status(400).json({ status: false, msg: `الحقل ${field} مطلوب` });
      }
    }

    function formatMobile(phone) {
      let d = String(phone).replace(/\D/g, "");
      if (d.startsWith("964")) d = d.slice(3);
      if (d.startsWith("0")) d = d.slice(1);
      return "+964" + d;
    }

    const payload = {
      client_name: b.client_name,
      client_mobile: formatMobile(b.client_mobile),
      city_id: b.city_id,
      region_id: b.region_id,
      location: b.location,
      type_name: b.type_name,
      items_number: b.items_number,
      price: b.price,
      package_size: b.package_size,
      replacement: b.replacement != null ? b.replacement : 0,
    };

    if (b.client_mobile2) payload.client_mobile2 = formatMobile(b.client_mobile2);
    if (b.merchant_notes) payload.merchant_notes = b.merchant_notes;

    const result = await waseetPost("create-order", payload);

    if (!result.status) {
      return res.status(400).json(result);
    }

    const order = Array.isArray(result.data) ? result.data[0] : result.data;

    return res.status(200).json({
      status: true,
      qr_id: order?.qr_id,
      qr_link: order?.qr_link,
      company_price: order?.company_price,
      data: order,
    });
  } catch (err) {
    return res.status(500).json({ status: false, msg: err.message });
  }
};
