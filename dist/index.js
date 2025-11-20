"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const body_parser_1 = __importDefault(require("body-parser"));
const axios_1 = __importDefault(require("axios"));
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
const app = (0, express_1.default)();
app.use(body_parser_1.default.json());
// ✅ Tokens y configuración
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const APPSHEET_API_KEY = process.env.APPSHEET_API_KEY;
const APPSHEET_URL = process.env.APPSHEET_URL;
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const proveedores = new Map();
// 🛑 Evitar procesar dos veces el mismo mensaje de WhatsApp
const mensajesProcesados = new Set();
// -------------------------------------
// 1️⃣ VERIFICAR CONEXIÓN CON META
// -------------------------------------
app.get("/webhook", (req, res) => {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];
    if (mode === "subscribe" && token === VERIFY_TOKEN) {
        console.log("✅ Webhook verificado correctamente");
        res.status(200).send(challenge);
    }
    else {
        console.log("❌ Error de verificación de Webhook");
        res.sendStatus(403);
    }
});
// -------------------------------------
// 2️⃣ RECIBIR MENSAJES DE WHATSAPP
// -------------------------------------
app.post("/webhook", async (req, res) => {
    console.log("📩 Webhook recibido:", JSON.stringify(req.body, null, 2));
    res.sendStatus(200); // Responde a Meta de inmediato
    try {
        const entry = req.body.entry?.[0];
        const changes = entry?.changes?.[0];
        // 🔥🔥 IMPORTANTE — IGNORAR ESTADOS
        if (changes?.value?.statuses) {
            return; // evita loops y mensajes repetidos
        }
        const message = changes?.value?.messages?.[0];
        const from = message?.from;
        if (!message || !from)
            return;
        // 🛑 ANTI-DUPLICADOS REAL
        if (message.id) {
            if (mensajesProcesados.has(message.id)) {
                console.log("⚠️ Mensaje repetido ignorado:", message.id);
                return;
            }
            mensajesProcesados.add(message.id);
            // Se limpia después de 2 minutos
            setTimeout(() => mensajesProcesados.delete(message.id), 120000);
        }
        // -------------------------------------
        //  BOTÓN PRESIONADO
        // -------------------------------------
        if (message.type === "button") {
            const payload = message.button?.payload || "";
            console.log(`🧾 Payload recibido: ${payload}`);
            // CONFIRMAR SERVICIO
            if (payload.startsWith("CONFIRMAR_SERVICIO_")) {
                const idServicio = payload.replace("CONFIRMAR_SERVICIO_", "");
                // 🚨 Protección — si ya está manejando un servicio, bloquea
                if (proveedores.has(from)) {
                    console.log("⚠️ Ya tenía un servicio activo, limpiando...");
                    proveedores.delete(from);
                }
                proveedores.set(from, { idServicio });
                await enviarMensajeWhatsApp(from, "Por favor, escribe **SOLO LA PLACA DE LA MOTO** que realizará el servicio. Ejemplo: ABC123");
                return;
            }
            // NO DISPONIBLE
            if (payload.startsWith("NO_DISPONIBLE_")) {
                const idServicio = payload.replace("NO_DISPONIBLE_", "");
                await actualizarAppSheetFinal(idServicio, false);
                await enviarMensajeWhatsApp(from, "Has indicado que no estás disponible. Gracias por confirmar 👍");
                return;
            }
        }
        // -------------------------------------
        //  TEXTO — SOLO PLACA (valor desactivado)
        // -------------------------------------
        if (message.type === "text") {
            const texto = message.text?.body?.trim()?.toUpperCase();
            const data = proveedores.get(from);
            if (!data)
                return;
            // 1️⃣ Esperando PLACA
            if (!data.placa) {
                data.placa = texto;
                proveedores.set(from, data);
                // 🔥 Lógica actual: flujo termina después de placa
                await actualizarAppSheetFinal(data.idServicio, true, data.placa);
                await enviarMensajeWhatsApp(from, `✅ Placa *${texto}* registrada.\nPuedes proceder con el domicilio 🏍️`);
                // 🚨 Muy importante: eliminar flujo para evitar mensajes repetitivos
                proveedores.delete(from);
                return;
            }
            // --------------------------------------------------
            // 🔥🔥 LÓGICA DEL VALOR DEL SERVICIO (DESACTIVADA)
            // Descomentar solo si en el futuro lo vuelves a activar
            // --------------------------------------------------
            /*
            if (!data.valor) {
              const valor = parseInt(texto.replace(/\D/g, ""), 10);
      
              if (isNaN(valor)) {
                await enviarMensajeWhatsApp(
                  from,
                  "⚠️ Escribe solo el valor del servicio en números. Ejemplo: 15000"
                );
                return;
              }
      
              data.valor = valor;
      
              await actualizarAppSheetFinal(
                data.idServicio,
                true,
                data.placa,
                valor
              );
      
              await enviarMensajeWhatsApp(
                from,
                `💰 Valor confirmado: *$${valor.toLocaleString()}*.\nPuedes proceder con el domicilio 🏍️`
              );
      
              proveedores.delete(from);
              return;
            }
            */
        }
    }
    catch (err) {
        console.error("❌ Error procesando webhook:", err);
    }
});
// -------------------------------------
// 3️⃣ ACTUALIZAR APPSHEET
// -------------------------------------
async function actualizarAppSheetFinal(idServicio, confirmado, placa, valor) {
    try {
        const row = {
            id_domicilio: idServicio,
            webhooklogID: confirmado,
        };
        if (placa)
            row.placa = placa;
        if (valor)
            row.valor_servicio = valor; // se enviará solo cuando actives valor
        const payload = {
            Action: "Edit",
            Properties: { Locale: "es-ES" },
            Rows: [row],
        };
        await axios_1.default.post(APPSHEET_URL, payload, {
            headers: {
                ApplicationAccessKey: APPSHEET_API_KEY,
                "Content-Type": "application/json",
            },
        });
        console.log(`✅ AppSheet actualizado: ${idServicio} | Confirmado=${confirmado} | Placa=${placa} | Valor=${valor}`);
    }
    catch (error) {
        console.error("❌ Error actualizando AppSheet:", error);
    }
}
// -------------------------------------
// 4️⃣ ENVIAR MENSAJE DE WHATSAPP
// -------------------------------------
async function enviarMensajeWhatsApp(to, mensaje) {
    try {
        await axios_1.default.post(`https://graph.facebook.com/v17.0/${PHONE_NUMBER_ID}/messages`, {
            messaging_product: "whatsapp",
            to,
            text: { body: mensaje },
        }, {
            headers: {
                Authorization: `Bearer ${WHATSAPP_TOKEN}`,
                "Content-Type": "application/json",
            },
        });
        console.log(`💬 Mensaje enviado a ${to}: ${mensaje}`);
    }
    catch (error) {
        console.error("❌ Error enviando mensaje de WhatsApp:", error.response?.data || error.message);
    }
}
// -------------------------------------
const PORT = process.env.PORT || 3500;
app.listen(PORT, () => console.log(`🚀 Servidor escuchando en puerto ${PORT}`));
