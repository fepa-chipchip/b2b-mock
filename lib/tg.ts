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
  thanks:
    "Thank you. Send your order here any way you like: a list, a photo or a file.\n\n" +
    "እናመሰግናለን። ትዕዛዝዎን እዚህ ይላኩ፦ ዝርዝር፣ ፎቶ ወይም ፋይል።",
  // New-customer sign-up, started by the agent: the intro, four questions one at a time, then Simenesh decides.
  signup_start:
    "This number is not a ChipChip business customer yet. Let's sign you up with four short questions.\n\n" +
    "ይህ ቁጥር ገና የቺፕቺፕ ድርጅት ደንበኛ አይደለም። በአራት አጭር ጥያቄዎች እንመዝግብዎት።",
  ask_business_name:
    "What is the name of your business?\n\nየድርጅትዎ ስም ማን ነው?",
  ask_business_type:
    "What kind of business is it?\n\nምን ዓይነት ድርጅት ነው?",
  business_types: [
    { value: "Restaurant", label: "Restaurant / ምግብ ቤት" },
    { value: "Hotel", label: "Hotel / ሆቴል" },
    { value: "Corporate", label: "Corporate / ኮርፖሬት" },
    { value: "Other", label: "Other / ሌላ" },
  ],
  ask_type_other:
    "Please tell us in your own words what kind of business it is.\n\nእባክዎ የድርጅትዎን ዓይነት በራስዎ ቃላት ይንገሩን።",
  ask_tin:
    "What is your business's TIN (tax number)? If you do not have one yet, press the button.\n\n" +
    "የድርጅትዎ የግብር ከፋይ መለያ ቁጥር (TIN) ስንት ነው? ገና ከሌለዎት ቁልፉን ይጫኑ።",
  no_tin_button: "No TIN yet / ገና TIN የለኝም",
  ask_location:
    "Where should we deliver? Press the button to share your location, or type the address.\n\n" +
    "የት እናድርስ? አካባቢዎን ለማጋራት ቁልፉን ይጫኑ፣ ወይም አድራሻውን ይጻፉ።",
  location_button: "Share my location / አካባቢዬን አጋራ",
  signup_done:
    "Thank you! Simenesh will confirm your registration shortly. You can already send your order here: a list, a photo or a file.\n\n" +
    "እናመሰግናለን! ስመኝሽ ምዝገባዎን በቅርቡ ታረጋግጣለች። ትዕዛዝዎን አሁኑኑ እዚህ መላክ ይችላሉ፦ ዝርዝር፣ ፎቶ ወይም ፋይል።",
  registered: (business: string, hasOrder: boolean) =>
    hasOrder
      ? `You're registered for ${business}. Your order is being prepared.\n\nለ${business} ተመዝግበዋል። ትዕዛዝዎ እየተዘጋጀ ነው።`
      : `You're registered for ${business}. Send your order here any way you like: a list, a photo or a file.\n\n` +
        `ለ${business} ተመዝግበዋል። ትዕዛዝዎን እዚህ ይላኩ፦ ዝርዝር፣ ፎቶ ወይም ፋይል።`,
  signup_declined:
    "Thank you for your interest. We cannot open a business account for this number at the moment. " +
    "Please contact ChipChip if you have questions.\n\n" +
    "ስለ ፍላጎትዎ እናመሰግናለን። ለዚህ ቁጥር በአሁኑ ጊዜ የድርጅት መለያ መክፈት አልቻልንም። ጥያቄ ካለዎት እባክዎ ቺፕቺፕን ያግኙ።",
  need_phone:
    "Please share your phone number first with the button below.\n\nእባክዎ መጀመሪያ ከታች ባለው ቁልፍ ስልክ ቁጥርዎን ያጋሩ።",
  received:
    "Received ✅ We will send you the order to confirm shortly.\n\nደርሶናል ✅ ትዕዛዙን በቅርቡ እንልክልዎታለን።",
  company_set: (name: string) => `Noted: ${name}.\n\nተመዝግቧል፦ ${name}።`,
  created: (id: number, total: string, date: string) =>
    `Your order #${id} is confirmed: ${total} ETB, delivery ${date}. Thank you!\n\n` +
    `ትዕዛዝዎ #${id} ተረጋግጧል፦ ${total} ብር፣ የሚደርሰው ${date}። እናመሰግናለን!`,
};
