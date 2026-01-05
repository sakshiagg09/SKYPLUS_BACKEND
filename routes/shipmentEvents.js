// routes/shipmentEvents.js
import express from "express";
import { getPool } from "../config/db.js";

const router = express.Router();

/**
 * GET /api/shipment-events
 * Returns all shipment rows
 */
router.get("/shipment-tracking-data", async (req, res) => {
  const { foId } = req.query;   // ✅ FIX

  if (!foId) {
    return res.status(400).json({ error: "foId is required" });
  }

  try {
    const pool = await getPool();
    const result = await pool.request()
      .input("FoId", foId)
      .query(`
        SELECT *
        FROM dbo.FreightOrderDetails
        WHERE FoId = @FoId
      `);

    res.json(result.recordset[0] ?? null);
  } catch (err) {
    console.error("Tracking Header Error:", err);
    res.status(500).json({ error: "Failed to fetch tracking header" });
  }
});

export default router;
