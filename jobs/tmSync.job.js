import cron from "node-cron";
import { syncTMToAzure } from "../services/tmToAzure.service.js";

// Run every 2 minutes
cron.schedule("*/2 * * * *", async () => {
  try {
    console.log("⏳ TM Sync started");
    const result = await syncTMToAzure();
    console.log("✅ TM Sync completed:", result.count);
  } catch (err) {
    console.error("❌ TM Sync failed:", err.message);
  }
});
