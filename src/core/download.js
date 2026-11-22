// Save a file from the page: a temporary link is clicked, and the object URL
// is released a little later (released at once, some browsers cancel the
// download).
export function downloadBlob(blob,filename){
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');
  a.href=url; a.download=filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}
export function downloadText(text,filename,type='text/plain;charset=utf-8'){
  downloadBlob(new Blob([text],{type}),filename);
}
