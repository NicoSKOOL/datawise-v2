import type { GeoGridPoint, GeoGridRankedBusiness } from '@/types/local-seo';

// HTML for the Leaflet popup on a grid point: the user's position plus who
// ranks at that exact spot (feature request fa53b468). Business names come
// from Google, so everything is escaped before it goes into innerHTML.

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function statusLine(point: GeoGridPoint): string {
  if (point.position != null) return `<strong>Your position: #${point.position}</strong>`;
  return point.total_results < 20
    ? "<strong>Not shown by Google here</strong><br><span style=\"color:#6b7280\">Google's local results at this point don't include you (too far away)</span>"
    : '<strong>Not in the top 20 here</strong>';
}

function row(b: GeoGridRankedBusiness): string {
  const rating = b.rating != null
    ? `${b.rating.toFixed(1)}&#9733;${b.reviews != null ? ` (${b.reviews})` : ''}`
    : '';
  const style = b.is_you ? 'background:#ecfdf5;font-weight:600;' : '';
  return `<tr style="${style}">`
    + `<td style="padding:2px 6px 2px 0;color:#6b7280;text-align:right;vertical-align:top">${b.position}</td>`
    + `<td style="padding:2px 6px 2px 0">${escapeHtml(b.title)}${b.is_you ? ' (you)' : ''}</td>`
    + `<td style="padding:2px 0;white-space:nowrap;color:#6b7280;text-align:right;vertical-align:top">${rating}</td>`
    + '</tr>';
}

export function geogridPointPopupHtml(point: GeoGridPoint): string {
  const parts = [statusLine(point)];
  const list = point.top20 ?? point.top_competitors ?? [];
  if (list.length > 0) {
    const heading = point.top20 ? `Top ${list.length} at this point` : 'Top competitors at this point';
    parts.push(
      `<div style="margin-top:6px;font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:#6b7280">${heading}</div>`,
      `<div style="max-height:260px;overflow-y:auto;margin-top:2px"><table style="border-collapse:collapse;font-size:12px;width:100%">${list.map(row).join('')}</table></div>`,
    );
    if (!point.top20) {
      parts.push('<div style="margin-top:4px;color:#6b7280;font-size:11px">Re-run the scan to see the full top 20 here.</div>');
    }
  } else {
    parts.push(`<div style="color:#6b7280">Results at this point: ${point.total_results}</div>`);
  }
  return `<div style="min-width:240px">${parts.join('')}</div>`;
}
