import { Request, Response } from "express";
import { getStatus, getQRImage, initWhatsApp, sendMessage, sendImage, disconnectWhatsApp } from "../services/whatsappService";
import { AuthRequest } from "../middleware/auth";

export async function statusHandler(req: AuthRequest, res: Response) {
  res.json(getStatus(req.user!.id));
}

export async function qrHandler(req: AuthRequest, res: Response) {
  try {
    const img = await getQRImage(req.user!.id);
    res.json({ qr: img });
  } catch {
    res.status(404).json({ error: "لا يوجد QR متاح، تأكد أن الواتساب بدأ التهيئة" });
  }
}

export async function connectHandler(req: AuthRequest, res: Response) {
  try {
    initWhatsApp(req.user!.id).catch(console.error);
    res.json({ message: "جاري تهيئة الواتساب..." });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}

export async function disconnectHandler(req: AuthRequest, res: Response) {
  try {
    await disconnectWhatsApp(req.user!.id);
    res.json({ message: "تم قطع الاتصال" });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}

export async function sendHandler(req: AuthRequest, res: Response) {
  const { phone, message } = req.body;
  if (!phone || !message) {
    res.status(400).json({ error: "phone و message مطلوبان" });
    return;
  }
  try {
    await sendMessage(req.user!.id, phone, message);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}

export async function sendImageHandler(req: AuthRequest, res: Response) {
  const { phone, imageBase64, caption } = req.body;
  if (!phone || !imageBase64) {
    res.status(400).json({ error: "phone و imageBase64 مطلوبان" });
    return;
  }
  try {
    await sendImage(req.user!.id, phone, imageBase64, caption || "");
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}
