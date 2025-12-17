import express, { Request, Response } from "express";
import bodyParser from "body-parser";
import axios from "axios";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(bodyParser.json());

// ✅ Tokens y configuración
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const APPSHEET_API_KEY = process.env.APPSHEET_API_KEY;
const APPSHEET_URL = process.env.APPSHEET_URL;
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;

// ✅ Cliente dedicado para AppSheet (TIMEOUT SEGURO)
const appSheetClient = axios.create({
  timeout: 90000, // ⏱️ 90 segundos
  headers: {
    ApplicationAccessKey: APPSHEET_API_KEY!,
    "Content-Type": "application/json",
  },
});

// 🧠 Memoria temporal del flujo por número
interface ProveedorData {
  idServicio: string;
  placa?: string;
  valor?: number;
  puntoRecogida?: string;
  puntoEntrega?: string;
}

const proveedores = new Map<string, ProveedorData>();
const mensajesProcesados = new Set<string>();

// -------------------------------------
// 1️⃣ VERIFICAR CONEXIÓN CON META
// -------------------------------------
app.get("/webhook", (req: Request, res: Response) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("✅ Webhook verificado correctamente");
    res.status(200).send(challenge);
  } else {
    console.log("❌ Error de verificación de Webhook");
    res.sendStatus(403);
  }
});

// -------------------------------------
// 2️⃣ RECIBIR MENSAJES DE WHATSAPP
// -------------------------------------
app.post("/webhook", async (req: Request, res: Response) => {
  console.log("📩 Webhook recibido:", JSON.stringify(req.body, null, 2));
  res.sendStatus(200);

  try {
    const entry = req.body.entry?.[0];
    const changes = entry?.changes?.[0];

    if (changes?.value?.statuses) return;
    if (!changes?.value?.messages?.length) return;

    const message = changes.value.messages[0];
    const from = message.from;
    if (!from) return;

    if (message.id) {
      if (mensajesProcesados.has(message.id)) return;
      mensajesProcesados.add(message.id);
      setTimeout(() => mensajesProcesados.delete(message.id), 120000);
    }

    // BOTÓN
    if (message.type === "button") {
      const payload = message.button?.payload || "";

      if (payload.startsWith("CONFIRMAR_SERVICIO_")) {
        const dataPayload = payload.replace("CONFIRMAR_SERVICIO_", "");
        const [idServicio, puntoRecogida, puntoEntrega] =
          dataPayload.split("|");

        proveedores.set(from, {
          idServicio,
          puntoRecogida,
          puntoEntrega,
        });

        await enviarMensajeWhatsApp(
          from,
          `🛵 *CONFIRMACIÓN DE DOMICILIO*

🆔 Servicio: ${idServicio}
📍 Recogida: ${puntoRecogida ?? "—"}
🎯 Entrega: ${puntoEntrega ?? "—"}

✍️ Escribe *SOLO LA PLACA DE LA MOTO*
Ejemplo: ABC123`
        );
        return;
      }

      if (payload.startsWith("NO_DISPONIBLE_")) {
        const idServicio = payload.replace("NO_DISPONIBLE_", "");

        // 👉 AppSheet en background (no bloquea WhatsApp)
        actualizarAppSheetFinal(idServicio, false).catch(() => {});

        await enviarMensajeWhatsApp(
          from,
          "Has indicado que no estás disponible. Gracias por confirmar 👍"
        );
        return;
      }
    }

    // TEXTO
    if (message.type === "text") {
      const texto = message.text?.body?.trim()?.toUpperCase();
      const data = proveedores.get(from);
      if (!data || !texto) return;

      if (!data.placa) {
        data.placa = texto;

        // 👉 AppSheet en background
        actualizarAppSheetFinal(data.idServicio, true, texto).catch(() => {});

        await enviarMensajeWhatsApp(
          from,
          `✅ Placa *${texto}* registrada.\nPuedes proceder con el domicilio 🏍️`
        );

        proveedores.delete(from);
      }
    }
  } catch (err) {
    console.error("❌ Error procesando webhook:", err);
  }
});

// -------------------------------------
// 3️⃣ ACTUALIZAR APPSHEET (CON TIMEOUT)
// -------------------------------------
async function actualizarAppSheetFinal(
  idServicio: string,
  confirmado: boolean,
  placa?: string,
  valor?: number
) {
  try {
    const row: any = {
      id_domicilio: idServicio,
      webhooklogID: confirmado,
    };

    if (placa) row.placa = placa;
    if (valor) row.valor_servicio = valor;

    const payload = {
      Action: "Edit",
      Properties: { Locale: "es-ES" },
      Rows: [row],
    };

    await appSheetClient.post(APPSHEET_URL!, payload);

    console.log(
      `✅ AppSheet actualizado: ${idServicio} | Confirmado=${confirmado}`
    );
  } catch (error: any) {
    if (error.code === "ECONNABORTED") {
      console.warn("⏱️ Timeout AppSheet (controlado)");
      return;
    }
    console.error(
      "❌ Error AppSheet:",
      error.response?.data || error.message
    );
  }
}

// -------------------------------------
// 4️⃣ ENVIAR MENSAJE DE WHATSAPP
// -------------------------------------
async function enviarMensajeWhatsApp(to: string, mensaje: string) {
  try {
    await axios.post(
      `https://graph.facebook.com/v17.0/${PHONE_NUMBER_ID}/messages`,
      {
        messaging_product: "whatsapp",
        to,
        text: { body: mensaje },
      },
      {
        headers: {
          Authorization: `Bearer ${WHATSAPP_TOKEN}`,
          "Content-Type": "application/json",
        },
      }
    );
  } catch (error: any) {
    console.error(
      "❌ Error enviando WhatsApp:",
      error.response?.data || error.message
    );
  }
}

// -------------------------------------
const PORT = process.env.PORT || 3500;
app.listen(PORT, () =>
  console.log(`🚀 Servidor escuchando en puerto ${PORT}`)
);
