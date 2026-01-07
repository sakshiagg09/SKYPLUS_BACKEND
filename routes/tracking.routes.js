import express from "express";

const router = express.Router();

// ---- in-memory store (minimal) ----
const latestByFo = new Map();   // FoId -> last point
const historyByFo = new Map();  // FoId -> [points]
const MAX_POINTS = 1000;

function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function normalize(p) {
  return {
    FoId: String(p.FoId),
    DriverId: String(p.DriverId || "DRIVER_001"),
    Latitude: toNum(p.Latitude),
    Longitude: toNum(p.Longitude),
    Accuracy: p.Accuracy == null ? null : toNum(p.Accuracy),
    Timestamp: toNum(p.Timestamp),
    Speed: p.Speed == null ? null : toNum(p.Speed),     // km/h from SKY
    Bearing: p.Bearing == null ? null : toNum(p.Bearing),
  };
}

// ✅ SKY -> SKY+ PUSH endpoint
router.post("/tracking/location", (req, res) => {
  try {
    const p0 = req.body || {};
    const p = normalize(p0);

    if (!p.FoId || p.Latitude == null || p.Longitude == null || p.Timestamp == null) {
      return res.status(400).json({
        error: "FoId, Latitude, Longitude, Timestamp required",
      });
    }

    latestByFo.set(p.FoId, p);

    const arr = historyByFo.get(p.FoId) || [];
    arr.push(p);
    if (arr.length > MAX_POINTS) arr.splice(0, arr.length - MAX_POINTS);
    historyByFo.set(p.FoId, arr);

    return res.status(204).end();
  } catch (e) {
    console.error("SKY+ receiver error:", e);
    return res.status(500).json({ error: String(e?.message || e) });
  }
});

// ✅ UI: get latest point (for moving marker)
router.get("/tracking/latest", (req, res) => {
  const FoId = req.query.FoId;
  if (!FoId) return res.status(400).json({ error: "FoId required" });

  return res.json(latestByFo.get(String(FoId)) || {});
});

// ✅ UI: get history points (for polyline)
router.get("/tracking/history", (req, res) => {
  const FoId = req.query.FoId;
  if (!FoId) return res.status(400).json({ error: "FoId required" });

  const limit = Math.max(1, Math.min(2000, Number(req.query.limit) || 300));
  const arr = historyByFo.get(String(FoId)) || [];
  return res.json(arr.slice(-limit));
});

export default router;
