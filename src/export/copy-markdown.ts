export async function copyMarkdown(markdown: string): Promise<boolean> {
  try {
    if (!navigator.clipboard?.writeText) return false;
    await navigator.clipboard.writeText(markdown);
    return true;
  } catch { return false; }
}
