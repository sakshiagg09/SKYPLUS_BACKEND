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

  /* ===================================================
     STEP 2: SKYPLUSFIELDSSET → ENRICHMENT (UPDATE ONLY)
     =================================================== */

  console.log("☁️ STEP 2: Syncing SkyPlusFieldsSet (UPDATE ONLY)");

  try {
    const skyRes = await axios.get(
      `${SAP_BASE}/SkyPlusFieldsSet?$format=json`,
      {
        headers: {
          Authorization: `Basic ${process.env.SAP_BASIC}`,
          Accept: "application/json"
        }
      }
    );

    const skyList = skyRes.data?.d?.results ?? [];
    console.log("📦 SKY records fetched:", skyList.length);

    for (const sky of skyList) {
      if (!sky.FoId) continue;

      const normalizedFoId = normalizeFoId(sky.FoId);

      console.log(
        "☁️ SKY Processing FoId:",
        sky.FoId,
        "→",
        normalizedFoId
      );

      const result = await pool.request()
        .input("FoId", sql.NVarChar, normalizedFoId)
        .input("CargoQuantity", sql.Decimal(18,3), sky.CargoQuantity ?? null)
        .input("CargoVolume", sql.Decimal(18,3), sky.CargoVolume ?? null)
        .input("CargoWeight", sql.Decimal(18,3), sky.CargoWeight ?? null)
        .input("QuantityUom", sql.NVarChar, sky.QuantityUom ?? null)
        .input("VolumeUom", sql.NVarChar, sky.VolumeUom ?? null)
        .input("WeightUom", sql.NVarChar, sky.WeightUom ?? null)
        .input("DepartureCountry", sql.NVarChar, sky.DepartureCountry ?? null)
        .input("ExecutionStatus", sql.NVarChar, sky.ExecutionStatus ?? null)
        .input("PlannedArrivalAt", sql.DateTime, sapTimestampToDate(sky.PlannedArrivalAt))
        .input("PlannedArrivalId", sql.NVarChar, sky.PlannedArrivalId ?? null)
        .input("PlannedDepartureAt", sql.DateTime, sapTimestampToDate(sky.PlannedDepartureAt))
        .input("PlannedDepartureId", sql.NVarChar, sky.PlannedDepartureId ?? null)
        .input("PlannedTotalDistance", sql.Decimal(18,3), sky.PlannedTotalDistance ?? null)
        .input("PlannedTotalUom", sql.NVarChar, sky.PlannedTotalUom ?? null)
        .query(`
          UPDATE dbo.FreightOrderDetails
          SET
            CargoQuantity=@CargoQuantity,
            CargoVolume=@CargoVolume,
            CargoWeight=@CargoWeight,
            QuantityUom=@QuantityUom,
            VolumeUom=@VolumeUom,
            WeightUom=@WeightUom,
            DepartureCountry=@DepartureCountry,
            ExecutionStatus=@ExecutionStatus,
            PlannedArrivalAt=@PlannedArrivalAt,
            PlannedArrivalId=@PlannedArrivalId,
            PlannedDepartureAt=@PlannedDepartureAt,
            PlannedDepartureId=@PlannedDepartureId,
            PlannedTotalDistance=@PlannedTotalDistance,
            PlannedTotalUom=@PlannedTotalUom,
            LastUpdated=GETDATE()
          WHERE FoId=@FoId
        `);

      if (result.rowsAffected[0] > 0) {
        console.log("✅ SKY Updated FoId:", normalizedFoId);
      } else {
        console.log("⚠️ SKY FoId not found in Azure (skipped):", normalizedFoId);
      }
    }
  } catch (err) {
    console.error("⚠️ SkyPlus sync failed (TM already synced)");
    console.error(err.message);
  }

  return { success: true, count };
}
