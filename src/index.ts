import express, { Request, Response } from "express";
import bodyParser from "body-parser";
import axios from "axios";

const app = express();
app.use(bodyParser.json());

// ✅ Tokens y configuración
const VERIFY_TOKEN = process.env.META_TOKEN;
const APPSHEET_API_KEY = process.env.APPSHEET_API_KEY;
const APPSHEET_URL = process.env.APPSHEET_URL1;
const WHATSAPP_TOKEN =  process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;

// 🧠 Memoria temporal del flujo por número
interface ProveedorData {
  idServicio: string;
  placa?: string;
  valor?: number;
}

const proveedores = new Map<string, ProveedorData>();

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
  res.sendStatus(200); // Responde a Meta de inmediato

  try {
    const entry = req.body.entry?.[0];
    const changes = entry?.changes?.[0];
    const message = changes?.value?.messages?.[0];
    const from = message?.from;

    if (!message || !from) return;

    // ✅ CASO 1: Botón presionado
    if (message.type === "button") {
      const payload = message.button?.payload || "";
      console.log(`🧾 Payload recibido: ${payload}`);

      // --- CONFIRMAR SERVICIO ---
      if (payload.startsWith("CONFIRMAR_SERVICIO_")) {
        const idServicio = payload.replace("CONFIRMAR_SERVICIO_", "");
        proveedores.set(from, { idServicio });

        await enviarMensajeWhatsApp(
          from,
          "Por favor, escribe **solo la placa de la moto** que realizará el servicio. Ejemplo: ABC123"
        );
        return;
      }

      // --- NO DISPONIBLE ---
      if (payload.startsWith("NO_DISPONIBLE_")) {
        const idServicio = payload.replace("NO_DISPONIBLE_", "");
        await actualizarAppSheetFinal(idServicio, false);
        await enviarMensajeWhatsApp(
          from,
          "Has indicado que no estás disponible. Gracias por confirmar 👍"
        );
        return;
      }
    }

    // ✅ CASO 2: Mensaje de texto — puede ser placa o valor
    if (message.type === "text") {
      const texto = message.text?.body?.trim()?.toUpperCase();

      // Si el número está en flujo
      const data = proveedores.get(from);
      if (!data) return;

      // Paso 1️⃣ — Si no tiene placa aún
      if (!data.placa) {
        data.placa = texto;
        proveedores.set(from, data);

        await enviarMensajeWhatsApp(
          from,
          `✅ Placa *${texto}* registrada.\nPor favor, escribe el **valor del servicio** en pesos (solo el número).`
        );
        return;
      }

      // Paso 2️⃣ — Si ya tiene placa pero no valor
      if (!data.valor) {
        const valor = parseInt(texto.replace(/\D/g, ""), 10);
        if (isNaN(valor)) {
          await enviarMensajeWhatsApp(
            from,
            "⚠️ Por favor, escribe solo el valor numérico. Ejemplo: 15000"
          );
          return;
        }

        data.valor = valor;

        // ✅ Guardar todo en AppSheet en una sola llamada
        await actualizarAppSheetFinal(data.idServicio, true, data.placa, data.valor);

        await enviarMensajeWhatsApp(
          from,
          `💰 Valor confirmado: *$${valor.toLocaleString()}*.\n✅ Todo correcto, puedes proceder con el domicilio 🏍️`
        );

        // Borrar datos de memoria
        proveedores.delete(from);
        return;
      }
    }
  } catch (err) {
    console.error("❌ Error procesando webhook:", err);
  }
});

// -------------------------------------
// 3️⃣ ACTUALIZAR APPSHEET (Una sola vez)
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

    await axios.post(APPSHEET_URL, payload, {
      headers: {
        ApplicationAccessKey: APPSHEET_API_KEY,
        "Content-Type": "application/json",
      },
    });

    console.log(
      `✅ AppSheet actualizado: ${idServicio} | Confirmado=${confirmado} | Placa=${placa} | Valor=${valor}`
    );
  } catch (error) {
    console.error("❌ Error actualizando AppSheet:", error);
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
    console.log(`💬 Mensaje enviado a ${to}: ${mensaje}`);
  } catch (error: any) {
    console.error(
      "❌ Error enviando mensaje de WhatsApp:",
      error.response?.data || error.message
    );
  }
}

// -------------------------------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Servidor escuchando en puerto ${PORT}`));
