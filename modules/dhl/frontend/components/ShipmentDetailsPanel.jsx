import React from 'react';

function Row({ label, value }) {
  if (value == null || value === '') return null;
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-2 py-1">
      <div className="text-xs text-gray-600">{label}</div>
      <div className="md:col-span-2 text-sm text-gray-900 break-words">{String(value)}</div>
    </div>
  );
}

function pick(obj, path) {
  try {
    const parts = String(path || '').split('.');
    let cur = obj;
    for (const p of parts) {
      if (cur == null) return null;
      cur = cur[p];
    }
    return cur;
  } catch { return null; }
}

export default function ShipmentDetailsPanel({ shipment }) {
  const s = shipment && typeof shipment === 'object' ? shipment : null;
  if (!s) return null;

  const id = s.id || s.shipmentId || s.shipmentID || null;
  const service = s.service || null;
  const originCC = pick(s, 'origin.address.countryCode') || pick(s, 'origin.countryCode') || null;
  const destCC = pick(s, 'destination.address.countryCode') || pick(s, 'destination.countryCode') || null;
  const eta = s.estimatedTimeOfDelivery || null;
  const etaFrom = pick(s, 'estimatedDeliveryTimeFrame.estimatedFrom') || null;
  const etaThrough = pick(s, 'estimatedDeliveryTimeFrame.estimatedThrough') || null;
  const status = s.status || null;
  const pieces = Array.isArray(s.pieces) ? s.pieces : [];
  const pieceIds = pieces.map((p) => p?.id).filter(Boolean);

  return (
    <details className="mt-3">
      <summary className="cursor-pointer text-sm font-medium text-gray-900">Shipment details</summary>
      <div className="mt-2 p-3 rounded border bg-white">
        <Row label="Shipment ID" value={id} />
        <Row label="Service" value={service} />
        <Row label="Origin country" value={originCC} />
        <Row label="Destination country" value={destCC} />
        <Row label="Estimated delivery date" value={eta} />
        <Row label="Estimated from" value={etaFrom} />
        <Row label="Estimated through" value={etaThrough} />
        <Row label="Status code" value={status?.statusCode} />
        <Row label="Status" value={status?.status} />
        <Row label="Description" value={status?.description} />
        <Row label="Remark" value={status?.remark} />
        <Row label="Pieces count" value={pieces.length ? String(pieces.length) : null} />
        <Row label="Piece IDs" value={pieceIds.length ? pieceIds.join(', ') : null} />
      </div>
    </details>
  );
}

