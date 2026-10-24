// A complete two-page PDF, rendered by the real PDF.js worker in the UI test.
export function samplePdf() {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 280] /Resources << >> /Contents 4 0 R >>",
    "<< /Length 29 >>\nstream\n1 0 0 rg 10 10 80 80 re f\n\n\n\n\nendstream",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 280] /Resources << >> /Contents 6 0 R >>",
    "<< /Length 29 >>\nstream\n0 0 1 rg 10 10 80 80 re f\n\n\n\n\nendstream",
  ];
  let source = "%PDF-1.7\n";
  const offsets = [0];
  objects.forEach((obj, index) => {
    offsets.push(source.length);
    source += `${index + 1} 0 obj\n${obj}\nendobj\n`;
  });
  const start = source.length;
  source += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  source += offsets
    .slice(1)
    .map((n) => `${String(n).padStart(10, "0")} 00000 n \n`)
    .join("");
  source += `trailer\n<< /Root 1 0 R /Size ${objects.length + 1} >>\nstartxref\n${start}\n%%EOF`;
  return new TextEncoder().encode(source);
}
