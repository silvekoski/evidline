import * as canvas from "@napi-rs/canvas";
import { getDocumentProxy, renderPageAsImage } from "unpdf";

export const OCR_SCALE = 2;

export type OpenPdf = { pages: number; render(page: number): Promise<Buffer>; close(): Promise<void> };

export async function openPdf(pdf: Buffer): Promise<OpenPdf> {
  const doc = await getDocumentProxy(new Uint8Array(pdf));
  return {
    pages: doc.numPages,
    render: async (page) => Buffer.from(await renderPageAsImage(doc, page, { scale: OCR_SCALE, canvasImport: () => Promise.resolve(canvas) })),
    close: () => doc.loadingTask.destroy(),
  };
}
