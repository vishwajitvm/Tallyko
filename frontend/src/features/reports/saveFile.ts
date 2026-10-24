/** Web: download a text file through a temporary object URL. (Native implementation: saveFile.native.ts.) */
export async function saveTextFile(filename: string, content: string, mimeType = 'text/csv'): Promise<void> {
  if (typeof document === 'undefined') throw new Error('Downloads are not available here.');
  const blob = new Blob([content], { type: `${mimeType};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Give the browser a moment to start the download before releasing the blob
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
