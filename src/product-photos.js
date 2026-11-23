import sharp from "sharp";
import { fail } from "./security.js";

export async function readProductPhoto(file) {
  if (!file?.buffer.length) fail(400, "Bitte ein Produktfoto auswählen.");
  const data = file.buffer;
  const jpeg = data.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]));
  const png = data.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"));
  const webp = data.toString("ascii", 0, 4) === "RIFF" &&
    data.toString("ascii", 8, 12) === "WEBP";
  if (!(jpeg || png || webp)) fail(400, "Bitte ein JPEG-, PNG- oder WebP-Bild auswählen.");

  try {
    return await sharp(data, { limitInputPixels: 25_000_000 })
      .autoOrient()
      .resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 88 })
      .toBuffer();
  } catch {
    fail(400, "Das Bild ist beschädigt oder hat zu viele Pixel.");
  }
}
