import {
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);

export async function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const key = await scrypt(password, salt, 64);
  return `${salt}:${key.toString("hex")}`;
}

export async function verifyPassword(password, hash) {
  const [salt, stored] = hash.split(":");
  const key = await scrypt(password, salt, 64);
  const expected = Buffer.from(stored, "hex");
  return key.length === expected.length && timingSafeEqual(key, expected);
}

export function fail(status, message) {
  const error = new Error(message);
  error.status = status;
  throw error;
}

export function text(value, field, max = 200) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > max) {
    fail(400, `${field}: Bitte 1 bis ${max} Zeichen eingeben.`);
  }
  return value.trim();
}

export function email(value) {
  const result = text(value, "E-Mail", 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result))
    fail(400, "Bitte eine gültige E-Mail-Adresse eingeben.");
  return result;
}

export function password(value) {
  if (typeof value !== "string" || value.length < 10 || value.length > 128) {
    fail(400, "Das Passwort muss 10 bis 128 Zeichen lang sein.");
  }
  return value;
}
