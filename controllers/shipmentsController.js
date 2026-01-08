const crypto = require("crypto");
const { connectDB, sql } = require("../config/db");

function mapRowToGraph(row) {
  const id =
    row.Id?.toString() ||
    row.ShipmentId?.toString() ||
    row.ContainerNumber?.toString() ||
    row.Container?.toString();

  return {
    id: id || crypto.randomUUID?.() || Math.random().toString(36).slice(2),
    fields: row,
  };
}

async function getShipmentEvents(req, res) {
  try {
    const container = req.query.container;
    if (!container) return res.status(400).json({ error: "container query param required" });

    const pool = await connectDB();
    const result = await pool
      .request()
      .input("container", sql.VarChar, container)
      .query(
        "SELECT * FROM ShipmentEvents WHERE ContainerNumber = @container ORDER BY ActualTime DESC"
      );

    return res.json(result.recordset ?? []);
  } catch (err) {
    console.error("[getShipmentEvents] DB error:", err);
    return res.status(500).json({ error: err.message });
  }
}

async function getUiFieldConfig(_req, res) {
  try {
    const pool = await connectDB();
    const result = await pool.request().query("SELECT Title, TechnicalName, Visible FROM UiFieldConfig");
    return res.json(result.recordset ?? []);
  } catch (err) {
    console.error("[getUiFieldConfig] DB error:", err);
    return res.status(500).json({ error: err.message });
  }
}

module.exports = {
  getShipmentEvents,
  getUiFieldConfig,
};
