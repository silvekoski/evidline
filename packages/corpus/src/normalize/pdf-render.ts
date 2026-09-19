import * as canvas from "@napi-rs/canvas";
import { renderPageAsImage } from "unpdf";

export const OCR_SCALE = 2;

export async function renderPdfPage(pdf: Buffer, page: number): Promise<Buffer> {
  const image = await renderPageAsImage(new Uint8Array(pdf), page, { scale: OCR_SCALE, canvasImport: () => Promise.resolve(canvas) });
  return Buffer.from(image);
}
