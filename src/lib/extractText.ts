// Reads the text of an uploaded knowledge file in the browser, so only text is
// sent to the server. PDF and Word readers load on demand.

export const KNOWLEDGE_ACCEPT = ".pdf,.docx,.txt,.md,.csv";
export const MAX_KNOWLEDGE_CHARS = 300_000;

async function pdfText(file: File): Promise<string> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const pages: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    let text = "";
    for (const item of content.items) {
      if ("str" in item) text += item.str + (item.hasEOL ? "\n" : " ");
    }
    pages.push(text.replace(/[ \t]+\n/g, "\n").trim());
  }
  return pages.filter(Boolean).join("\n\n");
}

async function docxText(file: File): Promise<string> {
  const mammoth = await import("mammoth/mammoth.browser");
  const result = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
  return result.value;
}

export async function extractText(file: File): Promise<string> {
  const name = file.name.toLowerCase();
  let text: string;
  if (name.endsWith(".pdf")) text = await pdfText(file);
  else if (name.endsWith(".docx")) text = await docxText(file);
  else if (/\.(txt|md|csv)$/.test(name)) text = await file.text();
  else throw new Error("Format belum didukung. Gunakan PDF, DOCX, TXT, MD, atau CSV.");

  text = text.split(String.fromCharCode(0)).join("").replace(/\n{3,}/g, "\n\n").trim();
  if (!text) throw new Error("Tidak ada teks yang bisa dibaca dari file ini (PDF hasil scan belum didukung).");
  return text;
}
