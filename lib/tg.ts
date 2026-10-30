/** The order bot's few Telegram calls. */
const api = (method: string) => `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/${method}`;

export async function tg(method: string, body: Record<string, unknown>) {
  const r = await fetch(api(method), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (!j.ok) console.log("telegram", method, j.description || r.status);
  return j;
}

export const send = (chat_id: number, text: string, extra: Record<string, unknown> = {}) =>
  tg("sendMessage", { chat_id, text, ...extra });

/** Downloads a file a customer sent, by its Telegram file_id. */
export async function download(file_id: string): Promise<{ bytes: ArrayBuffer; path: string } | null> {
  const j = await tg("getFile", { file_id });
  const path = j?.result?.file_path as string | undefined;
  if (!path) return null;
  const r = await fetch(`https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${path}`);
  if (!r.ok) return null;
  return { bytes: await r.arrayBuffer(), path };
}

/** What the bot says, English then Amharic. */
export const SAY = {
  welcome:
    "Welcome to ChipChip B2B orders. Please share your phone number with the button below so we know your company.\n\n" +
    "እንኳን ወደ ቺፕቺፕ B2B ትዕዛዝ በደህና መጡ። ድርጅትዎን እንድናውቅ እባክዎ ከታች ባለው ቁልፍ ስልክ ቁጥርዎን ያጋሩ።",
  share_button: "Share my phone number / ስልክ ቁጥሬን አጋራ",
  linked: (companies: string) =>
    `Thank you. You order for: ${companies}.\nSend your order here any way you like: a list, a photo or a file.\n\n` +
    `እናመሰግናለን። የሚያዙት ለ፦ ${companies}።\nትዕዛዝዎን እዚህ ይላኩ፦ ዝርዝር፣ ፎቶ ወይም ፋይል።`,
  unknown_phone:
    "We could not find this number among our business customers. Simenesh has been told and will add you.\n\n" +
    "ይህ ቁጥር በድርጅት ደንበኞቻችን ውስጥ አልተገኘም። ለስመኝሽ ተነግሯታል፣ ትጨምርዎታለች።",
  need_phone:
    "Please share your phone number first with the button below.\n\nእባክዎ መጀመሪያ ከታች ባለው ቁልፍ ስልክ ቁጥርዎን ያጋሩ።",
  received:
    "Received ✅ We will send you the order to confirm shortly.\n\nደርሶናል ✅ ትዕዛዙን በቅርቡ እንልክልዎታለን።",
  which_company:
    "Which company is this order for?\n\nይህ ትዕዛዝ ለየትኛው ድርጅት ነው?",
  company_set: (name: string) => `Noted: ${name}.\n\nተመዝግቧል፦ ${name}።`,
  created: (id: number, total: string, date: string) =>
    `Your order #${id} is confirmed: ${total} ETB, delivery ${date}. Thank you!\n\n` +
    `ትዕዛዝዎ #${id} ተረጋግጧል፦ ${total} ብር፣ የሚደርሰው ${date}። እናመሰግናለን!`,
};
