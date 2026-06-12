// ═══════════════════════════════════════════════════════════
//  /api/waseet-data
//  يجيب البيانات المرجعية من الوسيط: المدن، المناطق، الأحجام
//
//  الاستخدام:
//    GET /api/waseet-data?type=cities
//    GET /api/waseet-data?type=regions&city_id=1
//    GET /api/waseet-data?type=packages
//    GET /api/waseet-data?type=statuses
// ═══════════════════════════════════════════════════════════

import { waseetGet, setCors } from "./_waseet.js";

export default async function handler(req, res) {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    const { type, city_id } = req.query;

    let result;
    switch (type) {
      case "cities":
        result = await waseetGet("citys");
        break;
      case "regions":
        if (!city_id) {
          return res.status(400).json({ status: false, msg: "city_id مطلوب" });
        }
        result = await waseetGet("regions", { city_id });
        break;
      case "packages":
        result = await waseetGet("package-sizes");
        break;
      case "statuses":
        result = await waseetGet("statuses");
        break;
      default:
        return res.status(400).json({ status: false, msg: "type غير صالح" });
    }

    return res.status(200).json(result);
  } catch (err) {
    return res.status(500).json({ status: false, msg: err.message });
  }
}
