import express from "express";
import sql from "mssql";
import { getPool } from "../config/db.js";
import { syncAndGetEventsByFoId } from "../services/events.service.js";
const router = express.Router();

router.get("/events", async (req, res) => {
  const { foId } = req.query;

  if (!foId) {
    return res.status(400).json({ error: "foId is required" });
  }

  try {
    const pool = await getPool();

    const result = await pool.request()
      .input("FoId", sql.NVarChar, foId)
      .query(`
        SELECT *
        FROM dbo.Events
        WHERE FoId = @FoId
      `);

    res.json(result.recordset);
  } catch (err) {
    console.error("Events API error:", err.message);
    res.status(500).json({ error: "Failed to fetch events" });
  }
});
router.get("/", async (req, res) => {
  try {
    const { foId } = req.query;
    if (!foId) {
      return res.status(400).json({ error: "foId is required" });
    }

    const events = await syncAndGetEventsByFoId(foId);
    res.json(events);

  } catch (err) {
    console.error("❌ Events sync failed", err);
    res.status(500).json({ error: "Failed to fetch events" });
  }
});
export default router;
