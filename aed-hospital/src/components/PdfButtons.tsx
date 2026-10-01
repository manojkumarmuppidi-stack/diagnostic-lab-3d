"use client";
/** "Download PDF" (and "Share" on phones: WhatsApp, email…) for a server-generated PDF. */
import { useState } from "react";
import { FileDown, Share2 } from "lucide-react";
import { download, shareFile } from "@/lib/client";
import { Button, useToast } from "./ui";
import { useCan } from "./session";

export function PdfButtons({ url, title }: { url: string | null; title: string }) {
  const can = useCan();
  const toast = useToast();
  const [busy, setBusy] = useState<"" | "pdf" | "share">("");
  if (!url || !can("reports.export")) return null;
  const run = async (how: "pdf" | "share") => {
    setBusy(how);
    try {
      if (how === "share" && (await shareFile(url, title))) return;
      await download(url);
    } catch (e) {
      toast("error", (e as Error).message);
    } finally {
      setBusy("");
    }
  };
  return (
    <div className="flex gap-2">
      <Button variant="secondary" onClick={() => run("pdf")} loading={busy === "pdf"}>
        <FileDown className="h-4 w-4" /> Download PDF
      </Button>
      <Button variant="secondary" className="sm:hidden" onClick={() => run("share")} loading={busy === "share"}>
        <Share2 className="h-4 w-4" /> Share
      </Button>
    </div>
  );
}
