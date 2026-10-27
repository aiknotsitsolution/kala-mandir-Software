/** Minimal, dependency-free CSV export/import helpers. */
function escapeCell(value) {
    if (value === null || value === undefined)
        return "";
    const str = value instanceof Date ? value.toISOString() : String(value);
    if (/[",\n\r]/.test(str)) {
        return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
}
export function toCsv(rows, columns) {
    const head = columns.map((c) => escapeCell(c.header)).join(",");
    const body = rows.map((row) => columns.map((c) => escapeCell(c.accessor(row))).join(","));
    return [head, ...body].join("\r\n");
}
export function downloadCsv(filename, csv) {
    const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8;" });
    downloadBlob(filename.endsWith(".csv") ? filename : `${filename}.csv`, blob);
}
export function downloadBlob(filename, blob) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    // Give the browser a tick to start the download before revoking.
    setTimeout(() => URL.revokeObjectURL(url), 1500);
}
export function dataUrlToBlob(dataUrl) {
    const [header, base64] = dataUrl.split(",");
    const mime = /data:(.*?);/.exec(header)?.[1] ?? "application/octet-stream";
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1)
        bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: mime });
}
/** Trigger the browser print dialog for a prepared node. */
export function printElement() {
    window.print();
}
