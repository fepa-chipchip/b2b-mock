import { redirect } from "next/navigation";

/** The site opens on ChipChip B2B's Orders page, as the real dashboard does. */
export default function Home() {
  redirect("/b2b/orders");
}
