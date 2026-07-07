/** Cross-item annotation synthesis: one markdown bundle grouped by paper (54yyyu synthesis.py format). */

import { resolveScopeItems } from "./importService";

function stripHtml(html: string): string {
  return String(html).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

export async function synthesizeAnnotations(opts: {
  libraryID: number;
  collectionKey?: string;
  tag?: string;
  itemKeys?: string[];
  noteExcerptChars?: number;
}): Promise<any> {
  if (!opts.collectionKey && !opts.tag && !opts.itemKeys?.length) {
    throw new Error("Provide collectionKey, tag, or itemKeys — whole-library synthesis would flood the context");
  }
  const items = await resolveScopeItems(opts.libraryID, opts);

  const excerpt = Math.min(opts.noteExcerptChars ?? 400, 2000);
  let totalHighlights = 0,
    totalNotes = 0;
  const sections: string[] = [];

  for (const item of items) {
    const highlights: string[] = [];
    for (const attId of item.getAttachments()) {
      const att = Zotero.Items.get(attId);
      if (!att?.isAttachment?.()) continue;
      const anns: any[] = typeof (att as any).getAnnotations === "function" ? (att as any).getAnnotations() : [];
      for (const a of anns) {
        const text = String(a.annotationText || "").trim();
        const comment = String(a.annotationComment || "").trim();
        if (!text && !comment) continue;
        highlights.push(`- ${text}${comment ? ` — *${comment}*` : ""}`);
      }
    }
    const notes: string[] = [];
    for (const noteId of item.getNotes()) {
      const note = Zotero.Items.get(noteId);
      const text = stripHtml(note.getNote());
      if (text) notes.push(`- ${text.slice(0, excerpt)}${text.length > excerpt ? "…" : ""}`);
    }
    if (!highlights.length && !notes.length) continue;
    totalHighlights += highlights.length;
    totalNotes += notes.length;
    const parts = [`## ${item.getField("title")}`];
    if (highlights.length) parts.push(`**Highlights:**\n${highlights.join("\n")}`);
    if (notes.length) parts.push(`**Notes:**\n${notes.join("\n")}`);
    sections.push(parts.join("\n\n"));
  }

  const header = `**${sections.length} papers, ${totalHighlights} highlights, ${totalNotes} notes**`;
  const footer = `---\nYou can now synthesize themes, agreements, and contradictions across these papers.`;
  return {
    markdown: [header, ...sections, footer].join("\n\n"),
    papers: sections.length,
    highlights: totalHighlights,
    notes: totalNotes,
  };
}
