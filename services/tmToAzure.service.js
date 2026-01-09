import axios from "axios";
import sql from "mssql";
import { getPool } from "../config/db.js";
import { parseFinalInfo, sapTimestampToDate } from "./tmParser.service.js";

const SAP_BASE = process.env.SAP_BASE_URL;

/* ===================== HELPERS ===================== */

function deriveStatus(events = []) {
  if (!events.length) return "Planned";
  const last = events[events.length - 1];
  if (last.stopseqpos === "L" && last.event === "ARRIVAL") return "Delivered";
  return "In Transit";
}

// 🔑 IMPORTANT: Normalize SAP FoId (remove leading zeros)
function normalizeFoId(foId) {
  if (!foId) return foId;
  return String(foId).replace(/^0+/, "");
}

/* ===================== MAIN SYNC ===================== */

export async function syncTMToAzure() {
  const pool = await getPool();
  let count = 0;

  /* ===================================================
     STEP 1: SEARCHFOSET → MASTER DATA (INSERT / UPDATE)
     =================================================== */

  console.log("🚀 STEP 1: Syncing SearchFOSet (TM → Azure)");

  const tmRes = await axios.get(
    `${SAP_BASE}/SearchFOSet?$format=json`,
    {
      headers: {
        Authorization: `Basic ${process.env.SAP_BASIC}`,
        Accept: "application/json"
      }
    }
  );

  const fos = tmRes.data?.d?.results ?? [];
  console.log("📦 TM Freight Orders fetched:", fos.length);

  for (const fo of fos) {
    const normalizedFoId = normalizeFoId(fo.FoId);
    console.log("🟢 TM Processing FoId:", fo.FoId, "→", normalizedFoId);

    const events = parseFinalInfo(fo.FinalInfo);

    const lastEvent = events.length
      ? events[events.length - 1]
      : { stopid: "UNKNOWN" };

    const status = deriveStatus(events);

    try {
      await pool.request()
        .input("FoId", sql.NVarChar, normalizedFoId)
        .input("StopId", sql.NVarChar, lastEvent.stopid || "UNKNOWN")
        .input("StopSeqPos", sql.Char, lastEvent.stopseqpos ?? null)
        .input("Event", sql.NVarChar, lastEvent.event ?? null)
        .input("LocationType", sql.NVarChar, lastEvent.typeLoc ?? null)
        .input("LocId", sql.NVarChar, lastEvent.locid ?? null)
        .input("LocationName", sql.NVarChar, lastEvent.name1 ?? null)
        .input("Street", sql.NVarChar, lastEvent.street ?? null)
        .input("PostalCode", sql.NVarChar, lastEvent.postCode1 ?? null)
        .input("City", sql.NVarChar, lastEvent.city1 ?? null)
        .input("Region", sql.NVarChar, lastEvent.region ?? null)
        .input("Country", sql.NVarChar, lastEvent.country ?? null)
        .input("Latitude", sql.Decimal(18, 10), lastEvent.latitude ?? null)
        .input("Longitude", sql.Decimal(18, 10), lastEvent.longitude ?? null)
        .input("EventTime", sql.DateTime, new Date())
        .input("LicenseNumber", sql.NVarChar, fo.LicenseNumber ?? null)
        .input("Status", sql.NVarChar, status)
        .input("LastEvent", sql.NVarChar, lastEvent.event ?? null)
        .input("LastEventCity", sql.NVarChar, lastEvent.city1 ?? null)
        .query(`
          MERGE dbo.FreightOrderDetails T
          USING (SELECT @FoId FoId) S
          ON T.FoId = S.FoId
          WHEN MATCHED THEN
            UPDATE SET
              StopId=@StopId,
              StopSeqPos=@StopSeqPos,
              Event=@Event,
              LocationType=@LocationType,
              LocId=@LocId,
              LocationName=@LocationName,
              Street=@Street,
              PostalCode=@PostalCode,
              City=@City,
              Region=@Region,
              Country=@Country,
              Latitude=@Latitude,
              Longitude=@Longitude,
              EventTime=@EventTime,
              LicenseNumber=@LicenseNumber,
              Status=@Status,
              LastEvent=@LastEvent,
              LastEventCity=@LastEventCity,
              LastUpdated=GETDATE()
          WHEN NOT MATCHED THEN
            INSERT (
              FoId, StopId, StopSeqPos, Event, LocationType, LocId,
              LocationName, Street, PostalCode, City, Region, Country,
              Latitude, Longitude, EventTime, LicenseNumber,
              Status, LastEvent, LastEventCity, LastUpdated
            )
            VALUES (
              @FoId, @StopId, @StopSeqPos, @Event, @LocationType, @LocId,
              @LocationName, @Street, @PostalCode, @City, @Region, @Country,
              @Latitude, @Longitude, @EventTime, @LicenseNumber,
              @Status, @LastEvent, @LastEventCity, GETDATE()
            );
        `);

      console.log("✅ TM Synced FoId:", normalizedFoId);
      count++;
    } catch (err) {
      console.error("❌ TM Sync FAILED FoId:", normalizedFoId);
      console.error(err.message);
    }
  }

  

  return { success: true, count };
}
export async function updateSkyByFoId(foId) {
  const pool = await getPool();

const normalizedFoId = normalizeFoId(foId);

// 🔁 SAP needs padded FoId
const sapFoId = String(foId).padStart(22, "0");

console.log("☁️ SKY SAP FoId:", sapFoId);
console.log("🔧 SKY SQL FoId:", normalizedFoId);

const res = await axios.get(
  `${SAP_BASE}/SkyPlusFieldsSet?$filter=FoId eq '${sapFoId}'&$format=json`,
  {
    headers: {
      Authorization: `Basic ${process.env.SAP_BASIC}`,
      Accept: "application/json"
    }
  }
);


  const sky = res.data?.d?.results?.[0];

  if (!sky) {
    console.log("⚠️ No SKY data found for FoId:", foId);
    return { updated: false };
  }

  const result = await pool.request()
    .input("FoId", sql.NVarChar, normalizedFoId)
    .input("CargoQuantity", sql.Decimal(18, 3), sky.CargoQuantity ?? null)
    .input("CargoVolume", sql.Decimal(18, 3), sky.CargoVolume ?? null)
    .input("CargoWeight", sql.Decimal(18, 3), sky.CargoWeight ?? null)
    .input("ExecutionStatus", sql.NVarChar, sky.ExecutionStatus ?? null)
    .input("PlannedArrivalAt", sql.DateTime, sapTimestampToDate(sky.PlannedArrivalAt))
    .input("PlannedDepartureAt", sql.DateTime, sapTimestampToDate(sky.PlannedDepartureAt))
    .query(`
      UPDATE dbo.FreightOrderDetails
      SET
        CargoQuantity=@CargoQuantity,
        CargoVolume=@CargoVolume,
        CargoWeight=@CargoWeight,
        ExecutionStatus=@ExecutionStatus,
        PlannedArrivalAt=@PlannedArrivalAt,
        PlannedDepartureAt=@PlannedDepartureAt,
        LastUpdated=GETDATE()
      WHERE FoId=@FoId
    `);

  console.log("✅ SKY updated FoId:", normalizedFoId);
  return { updated: result.rowsAffected[0] > 0 };
}
