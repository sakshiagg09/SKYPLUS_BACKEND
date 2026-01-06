export function parseFinalInfo(finalInfo) {
  try {
    if (!finalInfo || finalInfo === "[]") return [];
    return JSON.parse(finalInfo);
  } catch (err) {
    console.error("FinalInfo parse error:", err);
    return [];
  }
}

export function sapTimestampToDate(ts) {
  if (!ts) return null;

  return new Date(
    `${ts.slice(0, 4)}-${ts.slice(4, 6)}-${ts.slice(6, 8)}T` +
    `${ts.slice(8, 10)}:${ts.slice(10, 12)}:${ts.slice(12, 14)}`
  );
}

export function parseSapEvent(ev) {
  return {
    FoId: ev.FoId,
    StopId: ev.StopId,
    Event: ev.Event,
    Action: ev.Action,
    EventCode: ev.EventCode,
    EvtReasonCode: ev.EvtReasonCode,
    Description: ev.Description,
    ETA: sapTimestampToDate(ev.ETA),
    Discrepency: ev.Discrepency ?? null,
    Items: ev.Items ? JSON.stringify(ev.Items) : null,
    ActualReportedTime: sapTimestampToDate(ev.Timestamp),
    PlannedTime: sapTimestampToDate(ev.PlannedTime),
    Latitude: ev.Latitude ? Number(ev.Latitude) : null,
    Longitude: ev.Longitude ? Number(ev.Longitude) : null
  };
}
