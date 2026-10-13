import { Client, LocalAuth } from "whatsapp-web.js";
import qrcode from "qrcode";

type Status = "disconnected" | "initializing" | "qr_ready" | "connected";

interface TeacherSession {
  client: Client | null;
  currentQR: string | null;
  status: Status;
}

const sessions = new Map<string, TeacherSession>();

function getSession(teacherId: string): TeacherSession {
  if (!sessions.has(teacherId)) {
    sessions.set(teacherId, { client: null, currentQR: null, status: "disconnected" });
  }
  return sessions.get(teacherId)!;
}

function formatNumber(phone: string) {
  let n = phone.replace(/\D/g, "");
  if (n.startsWith("0")) n = "2" + n;
  if (!n.startsWith("20")) n = "20" + n;
  return n;
}

export function getStatus(teacherId: string) {
  const s = getSession(teacherId);
  return { status: s.status, hasQR: !!s.currentQR };
}

export function getQRImage(teacherId: string): Promise<string> {
  const s = getSession(teacherId);
  if (!s.currentQR) return Promise.reject(new Error("لا يوجد QR متاح"));
  return qrcode.toDataURL(s.currentQR);
}

export async function initWhatsApp(teacherId: string) {
  const s = getSession(teacherId);
  if (s.client) return;
  s.status = "initializing";

  s.client = new Client({
    authStrategy: new LocalAuth({ clientId: teacherId, dataPath: ".wwebjs_auth" }),
    puppeteer: { args: ["--no-sandbox", "--disable-setuid-sandbox"] },
  });

  s.client.on("qr", (qr) => {
    s.currentQR = qr;
    s.status = "qr_ready";
    console.log(`[whatsapp:${teacherId}] QR جاهز`);
  });

  s.client.on("authenticated", () => {
    s.status = "initializing";
    s.currentQR = null;
    console.log(`[whatsapp:${teacherId}] تم المسح، جاري الاتصال...`);
  });

  s.client.on("ready", () => {
    s.status = "connected";
    s.currentQR = null;
    console.log(`[whatsapp:${teacherId}] متصل ✅`);
  });

  const thisClient = s.client;
  s.client.on("disconnected", () => {
    if (s.client === thisClient) s.client = null;
    s.status = "disconnected";
    console.log(`[whatsapp:${teacherId}] انقطع الاتصال`);
  });

  try {
    await s.client.initialize();
  } catch (err: any) {
    if (err?.message?.includes("Execution context was destroyed")) {
      console.warn(`[whatsapp:${teacherId}] Execution context destroyed during init, retrying...`);
      s.client = null;
      s.status = "disconnected";
      // Retry once after a short delay
      await new Promise((r) => setTimeout(r, 3000));
      await initWhatsApp(teacherId);
    } else {
      s.client = null;
      s.status = "disconnected";
      throw err;
    }
  }
}

export async function disconnectWhatsApp(teacherId: string) {
  const s = getSession(teacherId);
  s.status = "disconnected";
  s.currentQR = null;
  if (!s.client) return;
  const client = s.client;
  s.client = null;
  try {
    await client.destroy();
  } catch (err: any) {
    if (err?.code === "EBUSY") {
      // Windows holds a lock on Chromium session files briefly after destroy;
      // swallow the error — the session will be cleaned up on next restart
      console.warn(`[whatsapp:${teacherId}] EBUSY on session cleanup, ignoring`);
    } else {
      throw err;
    }
  }
}

export async function sendMessage(teacherId: string, phone: string, message: string) {
  const s = getSession(teacherId);
  if (!s.client || s.status !== "connected") throw new Error("واتساب غير متصل");
  const number = formatNumber(phone);
  await s.client.sendMessage(`${number}@c.us`, message);
}

export async function sendImage(teacherId: string, phone: string, imageBase64: string, caption: string) {
  const s = getSession(teacherId);
  if (!s.client || s.status !== "connected") throw new Error("واتساب غير متصل");
  const { MessageMedia } = await import("whatsapp-web.js");
  const base64Data = imageBase64.includes(",") ? imageBase64.split(",")[1] : imageBase64;
  const media = new MessageMedia("image/jpeg", base64Data, "report.jpg");
  const number = formatNumber(phone);
  await s.client.sendMessage(`${number}@c.us`, media, { caption });
}
